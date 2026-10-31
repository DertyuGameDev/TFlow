from contextlib import contextmanager
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from .contracts import FlowError, ProfileInput, validate
from .profile_data import PROFILE_LABELS, participant_profile
from .names import split_name
from .mailing import create_notifications
from .models import (
    Activity,
    CheckIn,
    Community,
    Event,
    EventRegistration,
    EventWaitlistEntry,
    Webinar,
    Membership,
    Notification,
    Registration,
    Room,
    ScheduleLock,
    User,
    WaitlistEntry,
)


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
        raise FlowError(
            "FORBIDDEN",
            "Управлять программой может только организатор этого мероприятия",
            403,
        )
    return event


def require_organizer(user):
    if not user.is_authenticated or user.role != "organizer":
        raise FlowError("FORBIDDEN", "Это действие доступно только организатору", 403)


def require_participant(user):
    if not user.is_authenticated or user.role != "participant":
        raise FlowError(
            "FORBIDDEN", "Запись на события доступна только участникам", 403
        )


def profile_updates(user, data):
    allowed = ProfileInput.base_fields.keys()
    supplied = {key: value for key, value in data.items() if key in allowed}
    if not supplied:
        return {}
    current = {
        key: value for key, value in participant_profile(user).items() if key in allowed
    }
    if "first_name" in supplied or "last_name" in supplied:
        first_name, last_name = (
            (user.first_name, user.last_name)
            if user.first_name or user.last_name
            else split_name(user.name)
        )
        current.update(first_name=first_name, last_name=last_name)
    values = validate(ProfileInput, {**current, **supplied})
    if {"name", "first_name", "last_name"} & supplied.keys():
        supplied.update(
            {key: values[key] for key in ("name", "first_name", "last_name")}
        )
    return {key: values[key] for key in supplied}


def save_profile(user, data):
    with schedule_write():
        person = User.objects.select_for_update().get(pk=user.pk)
        values = profile_updates(person, data)
        for key, value in values.items():
            setattr(person, key, value)
        if values:
            person.save(update_fields=list(values))
        for event in Event.objects.filter(waitlist_entries__user=person):
            promote_event_waitlist_locked(event)


def set_requirements(user, event_id, data):
    with schedule_write():
        event = owned_event(event_id, user)
        event.required_profile_fields = data["required_profile_fields"]
        event.updated_at = timezone.now()
        event.save(update_fields=["required_profile_fields", "updated_at"])
        promote_event_waitlist_locked(event)


def check_community(data, user, previous_id=None):
    if (
        data.get("community_id")
        and not Community.objects.filter(pk=data["community_id"]).exists()
    ):
        raise FlowError("INVALID_REFERENCE", "Сообщество не найдено", 400)
    club_id = data.get("community_id")
    if (
        club_id
        and club_id != previous_id
        and not (
            Community.objects.filter(pk=club_id, owner=user).exists()
            or Membership.objects.filter(community_id=club_id, user=user).exists()
        )
    ):
        raise FlowError(
            "CLUB_MEMBERSHIP",
            "Сначала вступите в клуб, чтобы добавить в него событие",
            403,
        )


def create_event(user, data):
    with schedule_write():
        require_organizer(user)
        check_community(data, user)
        return Event.objects.create(owner=user, **data)


def update_event(user, event_id, data):
    with schedule_write():
        event = owned_event(event_id, user)
        check_community(data, user, event.community_id)
        if data["format"] == "Очно" and event.webinars.filter(active=True).exists():
            raise FlowError(
                "WEBINAR_ACTIVE", "Завершите эфир перед сменой формата на очный"
            )
        if (
            data["format"] == "Очно"
            and event.activities.filter(room__is_online=True).exists()
        ):
            raise FlowError(
                "ONLINE_PROGRAM",
                "В программе есть онлайн-пункты. Выберите гибридный формат или перенесите их в очную аудиторию",
            )
        if event.enrollments.count() > data.get("capacity", event.capacity):
            raise FlowError(
                "BELOW_REGISTERED",
                "Нельзя уменьшить число мест ниже количества регистраций",
            )
        if event.activities.filter(
            Q(starts_at__lt=data["starts_at"]) | Q(ends_at__gt=data["ends_at"])
        ).exists():
            raise FlowError(
                "EVENT_DATES", "Активности должны проходить в пределах дат мероприятия"
            )
        changed = any(getattr(event, key) != value for key, value in data.items())
        for key, value in data.items():
            setattr(event, key, value)
        event.updated_at = timezone.now()
        event.save()
        if changed:
            users = set(event.enrollments.values_list("user_id", flat=True)) | set(
                Registration.objects.filter(activity__event=event).values_list(
                    "user_id", flat=True
                )
            )
            create_notifications(
                [
                    Notification(
                        user_id=uid,
                        event=event,
                        message=f"Обновлена информация о мероприятии «{event.title}».",
                    )
                    for uid in users
                ]
            )
        promote_event_waitlist_locked(event)
        return event


def publish_event(user, event_id):
    with schedule_write():
        event = owned_event(event_id, user)
        if event.status == "published":
            return
        event.status, event.updated_at = "published", timezone.now()
        event.save(update_fields=["status", "updated_at"])
        if event.community_id:
            recipients = (
                Membership.objects.filter(
                    community_id=event.community_id,
                    notify_events=True,
                    user__is_active=True,
                )
                .exclude(user_id=user.pk)
                .values_list("user_id", flat=True)
            )
            create_notifications(
                [
                    Notification(
                        user_id=uid,
                        event=event,
                        kind="club_event",
                        message=f"В клубе «{event.community.name}» опубликовано событие «{event.title}».",
                    )
                    for uid in recipients
                ]
            )


def set_community_subscription(user, community_id, enabled):
    if type(enabled) is not bool:
        raise FlowError("VALIDATION", "Укажите, включить ли уведомления", 400)
    with schedule_write():
        if not Community.objects.filter(pk=community_id).exists():
            raise FlowError("NOT_FOUND", "Клуб не найден", 404)
        if not Membership.objects.filter(user=user, community_id=community_id).update(
            notify_events=enabled
        ):
            raise FlowError("CLUB_MEMBERSHIP", "Сначала вступите в клуб", 403)


def save_community(user, data, community_id=None):
    from .interests import INTEREST_CATEGORIES

    if data["topic"] not in INTEREST_CATEGORIES:
        raise FlowError("VALIDATION", "Выберите категорию клуба из списка", 400)
    with schedule_write():
        if community_id:
            try:
                club = Community.objects.get(pk=community_id, owner=user)
            except Community.DoesNotExist as error:
                raise FlowError(
                    "FORBIDDEN", "Изменять клуб может только его создатель", 403
                ) from error
            for key, value in data.items():
                setattr(club, key, value)
            club.save()
        else:
            club = Community.objects.create(owner=user, color="yellow", **data)
            Membership.objects.create(community=club, user=user)
        return club


def delete_event(user, event_id):
    with schedule_write():
        event = owned_event(event_id, user)
        from .webinars import stop_webinar

        stop_webinar(event, all_rooms=True)
        title = event.title
        users = (
            set(event.enrollments.values_list("user_id", flat=True))
            | set(event.waitlist_entries.values_list("user_id", flat=True))
            | set(event.check_ins.values_list("user_id", flat=True))
            | set(
                Registration.objects.filter(activity__event=event).values_list(
                    "user_id", flat=True
                )
            )
            | set(
                WaitlistEntry.objects.filter(activity__event=event).values_list(
                    "user_id", flat=True
                )
            )
        ) - {user.pk}
        # Activities protect their rooms, so remove them before collecting rooms.
        event.activities.all().delete()
        event.delete()
        create_notifications(
            [
                Notification(
                    user_id=uid,
                    kind="event_cancelled",
                    message=f"Организатор отменил мероприятие «{title}». Ваша регистрация и записи на его активности отменены.",
                )
                for uid in users
            ]
        )


def save_room(user, data, *, event_id=None, room_id=None):
    with schedule_write():
        if room_id:
            try:
                room = Room.objects.get(pk=room_id)
            except Room.DoesNotExist as error:
                raise FlowError("NOT_FOUND", "Аудитория не найдена", 404) from error
            owned_event(room.event_id, user)
            if room.activities.filter(capacity__gt=data["capacity"]).exists():
                raise FlowError(
                    "ROOM_CAPACITY",
                    "Вместимость аудитории не может быть меньше лимита её активностей",
                )
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
        raise FlowError(
            "INVALID_REFERENCE", "Аудитория не принадлежит этому мероприятию", 400
        ) from error
    if activity.capacity > room.capacity:
        raise FlowError(
            "ROOM_CAPACITY", "Лимит участников превышает вместимость аудитории"
        )
    if activity.starts_at < event.starts_at or activity.ends_at > event.ends_at:
        raise FlowError(
            "EVENT_DATES", "Активности должны проходить в пределах дат мероприятия"
        )
    if (
        Activity.objects.filter(
            room=room, starts_at__lt=activity.ends_at, ends_at__gt=activity.starts_at
        )
        .exclude(pk=activity.pk)
        .exists()
    ):
        raise FlowError(
            "ROOM_CONFLICT",
            "В этой аудитории уже проходит другая активность. Измените время или аудиторию",
        )
    registered = Registration.objects.filter(activity_id=activity.pk)
    if activity.registration_required and registered.count() > activity.capacity:
        raise FlowError(
            "BELOW_REGISTERED",
            "Нельзя уменьшить лимит ниже числа зарегистрированных участников",
        )
    if (
        Registration.objects.filter(
            user_id__in=registered.values("user_id"),
            activity__starts_at__lt=activity.ends_at,
            activity__ends_at__gt=activity.starts_at,
        )
        .exclude(activity_id=activity.pk)
        .exists()
    ):
        raise FlowError(
            "ENROLLED_CONFLICT",
            "Перенос создаёт пересечение у зарегистрированных участников. Выберите другое время",
        )


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
        data = dict(data)
        if data.get("registration_required") is None:
            data.pop("registration_required", None)
        expected_updated_at = data.pop("expected_updated_at", None)
        if activity_id and expected_updated_at is not None and expected_updated_at != round(activity.updated_at.timestamp() * 1000):
            raise FlowError("STALE_ACTIVITY", "Этот пункт уже изменился. Обновите программу и повторите действие")
        new_room_name = data.pop("new_room_name", "")
        new_room_capacity = data.pop("new_room_capacity", None)
        online_room = data.pop("online_room", False)
        if new_room_name:
            room = Room.objects.create(
                event=activity.event,
                name=new_room_name,
                capacity=new_room_capacity or data["capacity"],
                is_online=online_room,
            )
            data["room_id"] = room.pk
        if online_room:
            if data.get("room_id"):
                if not Room.objects.filter(
                    pk=data["room_id"], event=activity.event, is_online=True
                ).exists():
                    raise FlowError(
                        "INVALID_REFERENCE",
                        "Выберите онлайн-аудиторию этого мероприятия",
                        400,
                    )
            else:
                online_rooms = list(activity.event.rooms.filter(is_online=True)[:2])
                if len(online_rooms) > 1:
                    raise FlowError("VALIDATION", "Выберите онлайн-аудиторию или создайте новый поток", 400)
                room = online_rooms[0] if online_rooms else Room.objects.create(
                    event=activity.event, is_online=True, name="Онлайн", capacity=activity.event.capacity,
                )
                data["room_id"] = room.pk
        if not data.get("room_id"):
            if activity_id:
                data["room_id"] = activity.room_id
            else:
                rooms = list(activity.event.rooms.all()[:2])
                if len(rooms) > 1:
                    raise FlowError(
                        "VALIDATION", "Выберите аудиторию для пункта программы", 400
                    )
                room = (
                    rooms[0]
                    if rooms
                    else Room.objects.create(
                        event=activity.event,
                        name=(
                            "Онлайн-комната"
                            if activity.event.format == "Онлайн"
                            else "Основная площадка"
                        ),
                        capacity=activity.event.capacity,
                        is_online=activity.event.format == "Онлайн",
                    )
                )
                data["room_id"] = room.pk
        changed = any(getattr(activity, key) != value for key, value in data.items())
        if activity_id and changed and Webinar.objects.filter(activity=activity, active=True).exists():
            raise FlowError("WEBINAR_ACTIVE", "Завершите эфир перед изменением этой активности")
        for key, value in data.items():
            setattr(activity, key, value)
        validate_activity(activity)
        activity.updated_at = timezone.now()
        activity.save()
        if activity.room.is_online and activity.event.format == "Очно":
            # Adding the virtual room enables the existing event webinar, while
            # retaining the physical venue and the rest of the program.
            activity.event.format = "Гибрид"
            activity.event.save(update_fields=["format"])
        Event.objects.filter(pk=activity.event_id).update(
            updated_at=activity.updated_at
        )
        if activity_id and changed:
            create_notifications(
                [
                    Notification(
                        user_id=uid,
                        event_id=activity.event_id,
                        message=f"Обновлена активность «{activity.title}». Проверьте время и аудиторию в своём расписании.",
                    )
                    for uid in set(
                        activity.registrations.values_list("user_id", flat=True)
                    )
                    | set(activity.waitlist.values_list("user_id", flat=True))
                ]
            )
        promote_waitlist_locked(activity)
        if activity_id:
            for participant in User.objects.filter(registrations__activity=activity):
                retry_user_waitlists_locked(participant)
        return activity


def participant_conflict(user, activity):
    return (
        Registration.objects.filter(
            user=user,
            activity__starts_at__lt=activity.ends_at,
            activity__ends_at__gt=activity.starts_at,
        )
        .exclude(activity=activity)
        .exists()
    )


def registration_activity(activity_id):
    try:
        activity = Activity.objects.select_related("event").get(pk=activity_id)
    except Activity.DoesNotExist as error:
        raise FlowError("NOT_FOUND", "Активность не найдена", 404) from error
    if activity.event.status != "published":
        raise FlowError(
            "NOT_PUBLISHED", "Регистрация на неопубликованную программу недоступна"
        )
    if (activity.starts_at if activity.registration_required else activity.ends_at) <= timezone.now():
        raise FlowError(
            "REGISTRATION_CLOSED", "Регистрация закрыта: активность уже началась" if activity.registration_required else "Активность уже завершилась"
        )
    return activity


def promote_waitlist_locked(activity):
    """Called only inside schedule_write(), including for capacity changes.

    A ticket is secured when joining the queue. Conflicting people keep their
    position while the next eligible person receives the seat.
    """
    if not activity.registration_required:
        activity.waitlist.all().delete()
        return
    if activity.event.status != "published" or activity.starts_at <= timezone.now():
        return
    free = activity.capacity - activity.registrations.count()
    if free <= 0:
        return
    for entry in activity.waitlist.select_related("user").order_by("id"):
        if (
            not entry.user.is_active
            or entry.user.role != "participant"
            or participant_conflict(entry.user, activity)
        ):
            continue
        if not EventRegistration.objects.filter(
            user=entry.user, event=activity.event
        ).exists():
            continue
        _, created = Registration.objects.get_or_create(
            user=entry.user, activity=activity
        )
        entry.delete()
        if created:
            free -= 1
            create_notifications(
                [
                    Notification(
                        user=entry.user,
                        event=activity.event,
                        message=f"Место освободилось! Вы автоматически записаны на «{activity.title}» из листа ожидания. Время и аудитория — в вашей программе.",
                    )
                ]
            )
        if free <= 0:
            break


def retry_user_waitlists_locked(user):
    # Cancelling a conflicting registration can make an already free seat usable.
    for entry in list(
        user.waitlist_entries.select_related("activity__event").order_by("id")
    ):
        promote_waitlist_locked(entry.activity)


def join_waitlist(user, activity_id, profile_data=None):
    require_participant(user)
    with schedule_write():
        activity = registration_activity(activity_id)
        if not activity.registration_required:
            raise FlowError("REGISTRATION_NOT_REQUIRED", "На эту активность не нужна отдельная запись. Добавьте её в расписание", 400)
        if activity.registrations.filter(user=user).exists():
            raise FlowError("ALREADY_REGISTERED", "Вы уже записаны на эту активность")
        if activity.waitlist.filter(user=user).exists():
            return
        if participant_conflict(user, activity):
            raise FlowError(
                "PARTICIPANT_CONFLICT",
                "Это время занято другой активностью в вашем расписании",
            )
        if activity.registrations.count() < activity.capacity:
            raise FlowError(
                "SEATS_AVAILABLE", "На активность есть места — запишитесь напрямую"
            )
        enroll_locked(user, activity.event, profile_data)
        WaitlistEntry.objects.create(user=user, activity=activity)


def leave_waitlist(user, activity_id):
    with schedule_write():
        WaitlistEntry.objects.filter(user=user, activity_id=activity_id).delete()


def register(user, activity_id, profile_data=None):
    require_participant(user)
    with schedule_write():
        activity = registration_activity(activity_id)
        if Registration.objects.filter(user=user, activity=activity).exists():
            raise FlowError("ALREADY_REGISTERED", "Вы уже записаны на эту активность")
        if not activity.registration_required:
            if not EventRegistration.objects.filter(user=user, event=activity.event).exists():
                raise FlowError("EVENT_REGISTRATION_REQUIRED", "Сначала зарегистрируйтесь на мероприятие", 403)
            if participant_conflict(user, activity):
                raise FlowError("PARTICIPANT_CONFLICT", "Это время занято другой активностью в вашем расписании")
            # A personal calendar entry only: no seat is reserved or taken from a quota.
            Registration.objects.create(user=user, activity=activity)
            return True
        if activity.registrations.count() >= activity.capacity:
            raise FlowError(
                "NO_SEATS", "Свободные места закончились. Выберите другую активность"
            )
        if participant_conflict(user, activity):
            raise FlowError(
                "PARTICIPANT_CONFLICT",
                "Это время занято другой активностью в вашем расписании",
            )
        # Fill eligible queued places first; a new request cannot jump the queue.
        promote_waitlist_locked(activity)
        if activity.registrations.filter(user=user).exists():
            return
        if activity.registrations.count() >= activity.capacity:
            # Return instead of raising: an exception would roll back promotions.
            return False
        enroll_locked(user, activity.event, profile_data)
        Registration.objects.create(user=user, activity=activity)
        activity.waitlist.filter(user=user).delete()
    return True


def cancel(user, activity_id):
    with schedule_write():
        removed, _ = Registration.objects.filter(
            user=user, activity_id=activity_id
        ).delete()
        if removed:
            activity = Activity.objects.select_related("event").get(pk=activity_id)
            from .webinars import disconnect_viewer
            if activity.registration_required:
                disconnect_viewer(user, activity.event_id, activity_id=activity.pk)
            promote_waitlist_locked(activity)
            retry_user_waitlists_locked(user)


def event_registration_profile_locked(user, event, profile_data=None):
    person = User.objects.select_for_update().get(pk=user.pk)
    values = profile_updates(person, profile_data or {})
    for key, value in values.items():
        setattr(person, key, value)
    missing = [key for key in event.required_profile_fields if not getattr(person, key)]
    if missing:
        error = FlowError("PROFILE_INCOMPLETE", "Дополните данные для записи", 409)
        error.missing_fields = missing
        error.fields = {
            key: [f"Заполните поле «{PROFILE_LABELS[key]}»"] for key in missing
        }
        raise error
    if values:
        person.save(update_fields=list(values))
    return participant_profile(person)


def eligible_event_waiters(event, registered):
    for entry in event.waitlist_entries.select_related("user").filter(
        user__is_active=True, user__role="participant",
    ).order_by("id"):
        if entry.user_id not in registered and all(
            getattr(entry.user, key) for key in event.required_profile_fields
        ):
            yield entry


def promote_event_waitlist_locked(event):
    """Allocate tickets in FIFO order while holding the shared schedule lock."""
    if event.status != "published" or event.ends_at <= timezone.now():
        return
    registered = set(event.enrollments.values_list("user_id", flat=True))
    free = event.capacity - len(registered)
    if free <= 0:
        return
    for entry in eligible_event_waiters(event, registered):
        EventRegistration.objects.create(
            user=entry.user, event=event, profile_data=participant_profile(entry.user),
        )
        entry.delete()
        create_notifications([Notification(
            user=entry.user, event=event, kind="event_waitlist",
            message=f"Место освободилось! Вы зарегистрированы на мероприятие «{event.title}» из листа ожидания. Событие добавлено в календарь, QR доступен в профиле.",
        )])
        free -= 1
        if free <= 0:
            break


def event_for_waitlist(event_id):
    try:
        event = Event.objects.get(pk=event_id)
    except Event.DoesNotExist as error:
        raise FlowError("NOT_FOUND", "Мероприятие не найдено", 404) from error
    if event.status != "published":
        raise FlowError("NOT_PUBLISHED", "Регистрация ещё не открыта")
    if event.ends_at <= timezone.now():
        raise FlowError("REGISTRATION_CLOSED", "Мероприятие уже завершилось")
    return event


def join_event_waitlist(user, event_id, profile_data=None):
    require_participant(user)
    with schedule_write():
        event = event_for_waitlist(event_id)
        if event.enrollments.filter(user=user).exists():
            return False
        event_registration_profile_locked(user, event, profile_data)
        EventWaitlistEntry.objects.get_or_create(user=user, event=event)
        promote_event_waitlist_locked(event)
        return event.waitlist_entries.filter(user=user).exists()


def leave_event_waitlist(user, event_id):
    require_participant(user)
    with schedule_write():
        event = Event.objects.filter(pk=event_id).first()
        if not event:
            raise FlowError("NOT_FOUND", "Мероприятие не найдено", 404)
        event.waitlist_entries.filter(user=user).delete()
        promote_event_waitlist_locked(event)
        return event.enrollments.filter(user=user).exists()


def enroll_locked(user, event, profile_data=None):
    require_participant(user)
    if event.status != "published":
        raise FlowError("NOT_PUBLISHED", "Регистрация ещё не открыта")
    if event.ends_at <= timezone.now():
        raise FlowError("REGISTRATION_CLOSED", "Мероприятие уже завершилось")
    existing = EventRegistration.objects.filter(user=user, event=event).first()
    if existing:
        return existing
    registered = set(event.enrollments.values_list("user_id", flat=True))
    if len(registered) >= event.capacity:
        raise FlowError("NO_SEATS", "Свободные места закончились")
    first = next(eligible_event_waiters(event, registered), None)
    if first and first.user_id != user.pk:
        raise FlowError("WAITLIST_PRIORITY", "Места распределяются по очереди. Встаньте в лист ожидания")
    snapshot = event_registration_profile_locked(user, event, profile_data)
    ticket = EventRegistration.objects.create(user=user, event=event, profile_data=snapshot)
    event.waitlist_entries.filter(user=user).delete()
    promote_event_waitlist_locked(event)
    return ticket


def enroll_event(user, event_id, profile_data=None):
    with schedule_write():
        try:
            event = Event.objects.get(pk=event_id)
        except Event.DoesNotExist as error:
            raise FlowError("NOT_FOUND", "Мероприятие не найдено", 404) from error
        enroll_locked(user, event, profile_data)


def cancel_event(user, event_id):
    with schedule_write():
        if CheckIn.objects.filter(user=user, event_id=event_id).exists():
            raise FlowError(
                "ALREADY_CHECKED_IN",
                "Вход уже подтверждён. Отменить регистрацию нельзя",
            )
        activities = list(
            Activity.objects.filter(
                event_id=event_id, registrations__user=user
            ).select_related("event")
        )
        from .webinars import disconnect_viewer

        disconnect_viewer(user, event_id)
        WaitlistEntry.objects.filter(user=user, activity__event_id=event_id).delete()
        Registration.objects.filter(user=user, activity__event_id=event_id).delete()
        EventRegistration.objects.filter(user=user, event_id=event_id).delete()
        EventWaitlistEntry.objects.filter(user=user, event_id=event_id).delete()
        for activity in activities:
            promote_waitlist_locked(activity)
        retry_user_waitlists_locked(user)
        event = Event.objects.filter(pk=event_id).first()
        if event:
            promote_event_waitlist_locked(event)


def move_event(user, event_id, data):
    with schedule_write():
        event = owned_event(event_id, user)
        if all(getattr(event, key) == value for key, value in data.items()):
            return
        delta = data["starts_at"] - event.starts_at
        activities = list(event.activities.select_related("room"))
        ids = [activity.pk for activity in activities]
        for activity in activities:
            try:
                start, end = activity.starts_at + delta, activity.ends_at + delta
            except OverflowError as error:
                raise FlowError(
                    "VALIDATION", "Дата программы выходит за допустимый диапазон", 400
                ) from error
            if start < data["starts_at"] or end > data["ends_at"]:
                raise FlowError(
                    "EVENT_DATES",
                    "Программа не помещается в новое время. Увеличьте длительность мероприятия",
                )
            if (
                Activity.objects.filter(
                    room_id=activity.room_id, starts_at__lt=end, ends_at__gt=start
                )
                .exclude(pk__in=ids)
                .exists()
            ):
                raise FlowError("ROOM_CONFLICT", "На новое время аудитория уже занята")
            users = activity.registrations.values("user_id")
            if (
                Registration.objects.filter(
                    user_id__in=users,
                    activity__starts_at__lt=end,
                    activity__ends_at__gt=start,
                )
                .exclude(activity_id__in=ids)
                .exists()
            ):
                raise FlowError(
                    "ENROLLED_CONFLICT",
                    "Перенос создаёт пересечение у участников. Выберите другое время",
                )
            activity.starts_at, activity.ends_at, activity.updated_at = (
                start,
                end,
                timezone.now(),
            )
        for key, value in data.items():
            setattr(event, key, value)
        event.updated_at = timezone.now()
        event.save()
        Activity.objects.bulk_update(activities, ["starts_at", "ends_at", "updated_at"])
        recipients = set(event.enrollments.values_list("user_id", flat=True)) | set(
            Registration.objects.filter(activity__event=event).values_list(
                "user_id", flat=True
            )
        )
        create_notifications(
            [
                Notification(
                    user_id=uid,
                    event=event,
                    message=f"Мероприятие «{event.title}» перенесено. Проверьте дату и место в календаре.",
                )
                for uid in recipients
            ]
        )
        for activity in activities:
            # Use the new event dates/status when processing its queues.
            activity.event = event
            promote_waitlist_locked(activity)
        for participant in User.objects.filter(
            registrations__activity__event=event
        ).distinct():
            retry_user_waitlists_locked(participant)
        promote_event_waitlist_locked(event)


def person_from_qr(raw):
    import uuid
    from urllib.parse import urlparse

    if not isinstance(raw, str) or len(raw) > 2048:
        raise FlowError("INVALID_QR", "Это не QR-код участника ТФлоу", 400)
    value = raw.strip()
    if "://" in value:
        try:
            parsed = urlparse(value)
        except ValueError as error:
            raise FlowError(
                "INVALID_QR", "Это не QR-код участника ТФлоу", 400
            ) from error
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
    person = User.objects.filter(
        pass_token=token, is_active=True, role="participant"
    ).first()
    return person


def attendee_by_qr(user, event_id, raw):
    event = owned_event(event_id, user)
    person = person_from_qr(raw)
    if not person or not event.enrollments.filter(user=person).exists():
        raise FlowError(
            "NOT_REGISTERED", "Нет регистрации на это мероприятие. Вход не подтверждён"
        )
    return event, person


def check_in(user, event_id, raw):
    with schedule_write():
        event, person = attendee_by_qr(user, event_id, raw)
        entry = mark_event_entry(user, event, person)
        return person, entry, False


def mark_event_entry(user, event, person, access_key=None):
    entry, created = CheckIn.objects.get_or_create(
        user=person, event=event, defaults={"checked_by": user, "access_key": access_key}
    )
    if not created:
        raise FlowError("ALREADY_CHECKED_IN", "QR-код уже использован для входа на это мероприятие. Повторный вход запрещён")
    return entry
