from contextlib import contextmanager
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from .contracts import FlowError
from .models import Activity, CheckIn, Community, Event, EventRegistration, Notification, Registration, Room, ScheduleLock, User, WaitlistEntry


@contextmanager
def schedule_write():
    # IMMEDIATE acquires the SQLite write lock before validation. PostgreSQL uses
    # this singleton row to serialize writes across events and user schedules.
    # Every operation that can affect the schedule must take this same lock.
    with transaction.atomic():
        ScheduleLock.objects.select_for_update().get(pk=1)
        yield


def owned_event(event_id, user):
    require_organizer(user)
    try:
        event = Event.objects.get(pk=event_id)
    except Event.DoesNotExist as error:
        raise FlowError("NOT_FOUND", "Мероприятие не найдено", 404) from error
    if event.owner_id != user.pk:
        raise FlowError("FORBIDDEN", "Управлять программой может только организатор этого мероприятия", 403)
    return event


def require_organizer(user):
    if not user.is_authenticated or user.role != "organizer":
        raise FlowError("FORBIDDEN", "Это действие доступно только организатору", 403)


def check_community(data):
    if data.get("community_id") and not Community.objects.filter(pk=data["community_id"]).exists():
        raise FlowError("INVALID_REFERENCE", "Сообщество не найдено", 400)


def create_event(user, data):
    with schedule_write():
        require_organizer(user)
        check_community(data)
        return Event.objects.create(owner=user, **data)


def update_event(user, event_id, data):
    with schedule_write():
        event = owned_event(event_id, user)
        check_community(data)
        if event.enrollments.count() > data["capacity"]:
            raise FlowError("BELOW_REGISTERED", "Нельзя уменьшить число мест ниже количества регистраций")
        if event.activities.filter(Q(starts_at__lt=data["starts_at"]) | Q(ends_at__gt=data["ends_at"])).exists():
            raise FlowError("EVENT_DATES", "Активности должны проходить в пределах дат мероприятия")
        changed = any(getattr(event, key) != value for key, value in data.items())
        for key, value in data.items():
            setattr(event, key, value)
        event.updated_at = timezone.now()
        event.save()
        if changed:
            users = Registration.objects.filter(activity__event=event).values_list("user_id", flat=True).distinct()
            Notification.objects.bulk_create([
                Notification(user_id=uid, event=event, message=f"Обновлена информация о мероприятии «{event.title}».")
                for uid in users
            ])
        return event


def publish_event(user, event_id):
    with schedule_write():
        event = owned_event(event_id, user)
        event.status, event.updated_at = "published", timezone.now()
        event.save(update_fields=["status", "updated_at"])


def save_room(user, data, *, event_id=None, room_id=None):
    with schedule_write():
        if room_id:
            try:
                room = Room.objects.get(pk=room_id)
            except Room.DoesNotExist as error:
                raise FlowError("NOT_FOUND", "Аудитория не найдена", 404) from error
            owned_event(room.event_id, user)
            if room.activities.filter(capacity__gt=data["capacity"]).exists():
                raise FlowError("ROOM_CAPACITY", "Вместимость аудитории не может быть меньше лимита её активностей")
            for key, value in data.items():
                setattr(room, key, value)
            room.save()
        else:
            event = owned_event(event_id, user)
            room = Room.objects.create(event=event, **data)
        return room


def validate_activity(activity):
    event = activity.event
    try:
        room = Room.objects.get(pk=activity.room_id, event=event)
    except Room.DoesNotExist as error:
        raise FlowError("INVALID_REFERENCE", "Аудитория не принадлежит этому мероприятию", 400) from error
    if activity.capacity > room.capacity:
        raise FlowError("ROOM_CAPACITY", "Лимит участников превышает вместимость аудитории")
    if activity.starts_at < event.starts_at or activity.ends_at > event.ends_at:
        raise FlowError("EVENT_DATES", "Активности должны проходить в пределах дат мероприятия")
    if Activity.objects.filter(room=room, starts_at__lt=activity.ends_at, ends_at__gt=activity.starts_at).exclude(pk=activity.pk).exists():
        raise FlowError("ROOM_CONFLICT", "В этой аудитории уже проходит другая активность. Измените время или аудиторию")
    registered = Registration.objects.filter(activity_id=activity.pk)
    if registered.count() > activity.capacity:
        raise FlowError("BELOW_REGISTERED", "Нельзя уменьшить лимит ниже числа зарегистрированных участников")
    if Registration.objects.filter(
        user_id__in=registered.values("user_id"),
        activity__starts_at__lt=activity.ends_at, activity__ends_at__gt=activity.starts_at,
    ).exclude(activity_id=activity.pk).exists():
        raise FlowError("ENROLLED_CONFLICT", "Перенос создаёт пересечение у зарегистрированных участников. Выберите другое время")


def save_activity(user, data, *, event_id=None, activity_id=None):
    with schedule_write():
        if activity_id:
            try:
                activity = Activity.objects.select_related("event").get(pk=activity_id)
            except Activity.DoesNotExist as error:
                raise FlowError("NOT_FOUND", "Активность не найдена", 404) from error
            owned_event(activity.event_id, user)
        else:
            activity = Activity(event=owned_event(event_id, user))
        for key, value in data.items():
            setattr(activity, key, value)
        validate_activity(activity)
        activity.updated_at = timezone.now()
        activity.save()
        Event.objects.filter(pk=activity.event_id).update(updated_at=activity.updated_at)
        if activity_id:
            Notification.objects.bulk_create([
                Notification(user_id=uid, event_id=activity.event_id,
                             message=f"Обновлена активность «{activity.title}». Проверьте время и аудиторию в своём расписании.")
                for uid in set(activity.registrations.values_list("user_id", flat=True)) | set(activity.waitlist.values_list("user_id", flat=True))
            ])
        promote_waitlist_locked(activity)
        if activity_id:
            for participant in User.objects.filter(registrations__activity=activity):
                retry_user_waitlists_locked(participant)
        return activity


def participant_conflict(user, activity):
    return Registration.objects.filter(user=user, activity__starts_at__lt=activity.ends_at,
                                       activity__ends_at__gt=activity.starts_at).exclude(activity=activity).exists()


def registration_activity(activity_id):
    try:
        activity = Activity.objects.select_related("event").get(pk=activity_id)
    except Activity.DoesNotExist as error:
        raise FlowError("NOT_FOUND", "Активность не найдена", 404) from error
    if activity.event.status != "published":
        raise FlowError("NOT_PUBLISHED", "Регистрация на неопубликованную программу недоступна")
    if activity.starts_at <= timezone.now():
        raise FlowError("REGISTRATION_CLOSED", "Регистрация закрыта: активность уже началась")
    return activity


def promote_waitlist_locked(activity):
    """Called only inside schedule_write(), including for capacity changes.

    A ticket is secured when joining the queue. Conflicting people keep their
    position while the next eligible person receives the seat.
    """
    if activity.event.status != "published" or activity.starts_at <= timezone.now():
        return
    free = activity.capacity - activity.registrations.count()
    if free <= 0:
        return
    for entry in activity.waitlist.select_related("user").order_by("id"):
        if not entry.user.is_active or participant_conflict(entry.user, activity):
            continue
        if not EventRegistration.objects.filter(user=entry.user, event=activity.event).exists():
            continue
        _, created = Registration.objects.get_or_create(user=entry.user, activity=activity)
        entry.delete()
        if created:
            free -= 1
            Notification.objects.create(user=entry.user, event=activity.event,
                message=f"Место освободилось! Вы автоматически записаны на «{activity.title}» из листа ожидания. Время и аудитория — в вашей программе.")
        if free <= 0:
            break


def retry_user_waitlists_locked(user):
    # Cancelling a conflicting registration can make an already free seat usable.
    for entry in list(user.waitlist_entries.select_related("activity__event").order_by("id")):
        promote_waitlist_locked(entry.activity)


def join_waitlist(user, activity_id):
    with schedule_write():
        activity = registration_activity(activity_id)
        if activity.registrations.filter(user=user).exists():
            raise FlowError("ALREADY_REGISTERED", "Вы уже записаны на эту активность")
        if activity.waitlist.filter(user=user).exists():
            return
        if participant_conflict(user, activity):
            raise FlowError("PARTICIPANT_CONFLICT", "Это время занято другой активностью в вашем расписании")
        if activity.registrations.count() < activity.capacity:
            raise FlowError("SEATS_AVAILABLE", "На активность есть места — запишитесь напрямую")
        enroll_locked(user, activity.event)
        WaitlistEntry.objects.create(user=user, activity=activity)


def leave_waitlist(user, activity_id):
    with schedule_write():
        WaitlistEntry.objects.filter(user=user, activity_id=activity_id).delete()


def register(user, activity_id):
    with schedule_write():
        activity = registration_activity(activity_id)
        if Registration.objects.filter(user=user, activity=activity).exists():
            raise FlowError("ALREADY_REGISTERED", "Вы уже записаны на эту активность")
        if activity.registrations.count() >= activity.capacity:
            raise FlowError("NO_SEATS", "Свободные места закончились. Выберите другую активность")
        if participant_conflict(user, activity):
            raise FlowError("PARTICIPANT_CONFLICT", "Это время занято другой активностью в вашем расписании")
        # Fill eligible queued places first; a new request cannot jump the queue.
        promote_waitlist_locked(activity)
        if activity.registrations.filter(user=user).exists():
            return
        if activity.registrations.count() >= activity.capacity:
            # Return instead of raising: an exception would roll back promotions.
            return False
        enroll_locked(user, activity.event)
        Registration.objects.create(user=user, activity=activity)
        activity.waitlist.filter(user=user).delete()
    return True


def cancel(user, activity_id):
    with schedule_write():
        removed, _ = Registration.objects.filter(user=user, activity_id=activity_id).delete()
        if removed:
            activity = Activity.objects.select_related("event").get(pk=activity_id)
            promote_waitlist_locked(activity)
            retry_user_waitlists_locked(user)


def enroll_locked(user, event):
    if event.status != "published":
        raise FlowError("NOT_PUBLISHED", "Регистрация ещё не открыта")
    if event.ends_at <= timezone.now():
        raise FlowError("REGISTRATION_CLOSED", "Мероприятие уже завершилось")
    if EventRegistration.objects.filter(user=user, event=event).exists():
        return
    if event.enrollments.count() >= event.capacity:
        raise FlowError("NO_SEATS", "Свободные места закончились")
    EventRegistration.objects.create(user=user, event=event)


def enroll_event(user, event_id):
    with schedule_write():
        try:
            event = Event.objects.get(pk=event_id)
        except Event.DoesNotExist as error:
            raise FlowError("NOT_FOUND", "Мероприятие не найдено", 404) from error
        enroll_locked(user, event)


def cancel_event(user, event_id):
    with schedule_write():
        if CheckIn.objects.filter(user=user, event_id=event_id).exists():
            raise FlowError("ALREADY_CHECKED_IN", "Вход уже подтверждён. Отменить этот билет нельзя")
        activities = list(Activity.objects.filter(event_id=event_id, registrations__user=user).select_related("event"))
        WaitlistEntry.objects.filter(user=user, activity__event_id=event_id).delete()
        Registration.objects.filter(user=user, activity__event_id=event_id).delete()
        EventRegistration.objects.filter(user=user, event_id=event_id).delete()
        for activity in activities:
            promote_waitlist_locked(activity)
        retry_user_waitlists_locked(user)


def move_event(user, event_id, data):
    with schedule_write():
        event = owned_event(event_id, user)
        delta = data["starts_at"] - event.starts_at
        activities = list(event.activities.select_related("room"))
        ids = [activity.pk for activity in activities]
        for activity in activities:
            start, end = activity.starts_at + delta, activity.ends_at + delta
            if start < data["starts_at"] or end > data["ends_at"]:
                raise FlowError("EVENT_DATES", "Программа не помещается в новое время. Увеличьте длительность мероприятия")
            if Activity.objects.filter(room_id=activity.room_id, starts_at__lt=end, ends_at__gt=start).exclude(pk__in=ids).exists():
                raise FlowError("ROOM_CONFLICT", "На новое время аудитория уже занята")
            users = activity.registrations.values("user_id")
            if Registration.objects.filter(user_id__in=users, activity__starts_at__lt=end, activity__ends_at__gt=start).exclude(activity_id__in=ids).exists():
                raise FlowError("ENROLLED_CONFLICT", "Перенос создаёт пересечение у участников. Выберите другое время")
            activity.starts_at, activity.ends_at, activity.updated_at = start, end, timezone.now()
        for key, value in data.items():
            setattr(event, key, value)
        event.updated_at = timezone.now()
        event.save()
        Activity.objects.bulk_update(activities, ["starts_at", "ends_at", "updated_at"])
        recipients = set(event.enrollments.values_list("user_id", flat=True)) | set(Registration.objects.filter(activity__event=event).values_list("user_id", flat=True))
        Notification.objects.bulk_create([Notification(user_id=uid, event=event, message=f"Мероприятие «{event.title}» перенесено. Проверьте дату и место в своих билетах.") for uid in recipients])
        for activity in activities:
            # Use the new event dates/status when processing its queues.
            activity.event = event
            promote_waitlist_locked(activity)
        for participant in User.objects.filter(registrations__activity__event=event).distinct():
            retry_user_waitlists_locked(participant)


def attendee_by_qr(user, event_id, raw):
    import uuid
    from urllib.parse import urlparse
    event = owned_event(event_id, user)
    if not isinstance(raw, str) or len(raw) > 2048:
        raise FlowError("INVALID_QR", "Это не QR-код участника ТФлоу", 400)
    value = raw.strip()
    if "://" in value:
        try:
            parsed = urlparse(value)
        except ValueError as error:
            raise FlowError("INVALID_QR", "Это не QR-код участника ТФлоу", 400) from error
        if parsed.scheme not in {"http", "https"}:
            raise FlowError("INVALID_QR", "Это не QR-код участника ТФлоу", 400)
        value = parsed.fragment.removeprefix("/")
        if not value.startswith("pass/"):
            raise FlowError("INVALID_QR", "Это не QR-код участника ТФлоу", 400)
        value = value[5:]
    try:
        token = uuid.UUID(value)
    except (ValueError, AttributeError) as error:
        raise FlowError("INVALID_QR", "Это не QR-код участника ТФлоу", 400) from error
    person = User.objects.filter(pass_token=token, is_active=True).first()
    if not person or not event.enrollments.filter(user=person).exists():
        raise FlowError("NOT_REGISTERED", "Нет регистрации на это мероприятие. Вход не подтверждён")
    return event, person


def check_in(user, event_id, raw):
    with schedule_write():
        event, person = attendee_by_qr(user, event_id, raw)
        entry, created = CheckIn.objects.get_or_create(user=person, event=event, defaults={"checked_by": user})
        return person, entry, not created
