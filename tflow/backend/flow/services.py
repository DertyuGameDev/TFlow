from contextlib import contextmanager
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from .contracts import FlowError, ProfileInput, validate
from .profile_data import PROFILE_LABELS, participant_profile
from .models import (
    Activity,
    CheckIn,
    Community,
    Event,
    EventRegistration,
    Notification,
    Registration,
    Room,
    ScheduleLock,
    User,
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


def become_organizer(user):
    """Enable event creation on the current account, preserving all other data."""
    User.objects.filter(pk=user.pk).update(role="organizer")
    user.role = "organizer"
    return user


def profile_updates(user, data):
    allowed = ProfileInput.base_fields.keys()
    supplied = {key: value for key, value in data.items() if key in allowed}
    if not supplied:
        return {}
    current = {key: value for key, value in participant_profile(user).items() if key in allowed}
    values = validate(ProfileInput, {**current, **supplied})
    return {key: values[key] for key in supplied}


def save_profile(user, data):
    with transaction.atomic():
        person = User.objects.select_for_update().get(pk=user.pk)
        values = profile_updates(person, data)
        for key, value in values.items():
            setattr(person, key, value)
        if values:
            person.save(update_fields=list(values))


def set_requirements(user, event_id, data):
    with schedule_write():
        event = owned_event(event_id, user)
        event.required_profile_fields = data["required_profile_fields"]
        event.updated_at = timezone.now()
        event.save(update_fields=["required_profile_fields", "updated_at"])


def check_community(data):
    if (
        data.get("community_id")
        and not Community.objects.filter(pk=data["community_id"]).exists()
    ):
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
            Notification.objects.bulk_create(
                [
                    Notification(
                        user_id=uid,
                        event=event,
                        message=f"Обновлена информация о мероприятии «{event.title}».",
                    )
                    for uid in users
                ]
            )
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
    if registered.count() > activity.capacity:
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
        for key, value in data.items():
            setattr(activity, key, value)
        validate_activity(activity)
        activity.updated_at = timezone.now()
        activity.save()
        Event.objects.filter(pk=activity.event_id).update(
            updated_at=activity.updated_at
        )
        if activity_id:
            Notification.objects.bulk_create(
                [
                    Notification(
                        user_id=uid,
                        event_id=activity.event_id,
                        message=f"Обновлена активность «{activity.title}». Проверьте время и аудиторию в своём расписании.",
                    )
                    for uid in activity.registrations.values_list("user_id", flat=True)
                ]
            )
        return activity


def register(user, activity_id, profile_data=None):
    with schedule_write():
        try:
            activity = Activity.objects.select_related("event").get(pk=activity_id)
        except Activity.DoesNotExist as error:
            raise FlowError("NOT_FOUND", "Активность не найдена", 404) from error
        if Registration.objects.filter(user=user, activity=activity).exists():
            raise FlowError("ALREADY_REGISTERED", "Вы уже записаны на эту активность")
        if activity.event.status != "published":
            raise FlowError(
                "NOT_PUBLISHED", "Регистрация на неопубликованную программу недоступна"
            )
        if activity.starts_at <= timezone.now():
            raise FlowError(
                "REGISTRATION_CLOSED", "Регистрация закрыта: активность уже началась"
            )
        if activity.registrations.count() >= activity.capacity:
            raise FlowError(
                "NO_SEATS", "Свободные места закончились. Выберите другую активность"
            )
        if Registration.objects.filter(
            user=user,
            activity__starts_at__lt=activity.ends_at,
            activity__ends_at__gt=activity.starts_at,
        ).exists():
            raise FlowError(
                "PARTICIPANT_CONFLICT",
                "Это время занято другой активностью в вашем расписании",
            )
        enroll_locked(user, activity.event, profile_data)
        Registration.objects.create(user=user, activity=activity)


def cancel(user, activity_id):
    with schedule_write():
        Registration.objects.filter(user=user, activity_id=activity_id).delete()


def enroll_locked(user, event, profile_data=None):
    if event.status != "published":
        raise FlowError("NOT_PUBLISHED", "Регистрация ещё не открыта")
    if event.ends_at <= timezone.now():
        raise FlowError("REGISTRATION_CLOSED", "Мероприятие уже завершилось")
    existing = EventRegistration.objects.filter(user=user, event=event).first()
    if existing:
        return existing
    if event.enrollments.count() >= event.capacity:
        raise FlowError("NO_SEATS", "Свободные места закончились")
    person = User.objects.select_for_update().get(pk=user.pk)
    values = profile_updates(person, profile_data or {})
    for key, value in values.items():
        setattr(person, key, value)
    missing = [key for key in event.required_profile_fields if not getattr(person, key)]
    if missing:
        error = FlowError("PROFILE_INCOMPLETE", "Дополните данные для записи", 409)
        error.missing_fields = missing
        error.fields = {key: [f"Заполните поле «{PROFILE_LABELS[key]}»"] for key in missing}
        raise error
    if values:
        person.save(update_fields=list(values))
    return EventRegistration.objects.create(user=person, event=event, profile_data=participant_profile(person))


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
                "ALREADY_CHECKED_IN", "Вход уже подтверждён. Отменить этот билет нельзя"
            )
        Registration.objects.filter(user=user, activity__event_id=event_id).delete()
        EventRegistration.objects.filter(user=user, event_id=event_id).delete()


def move_event(user, event_id, data):
    with schedule_write():
        event = owned_event(event_id, user)
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
        Notification.objects.bulk_create(
            [
                Notification(
                    user_id=uid,
                    event=event,
                    message=f"Мероприятие «{event.title}» перенесено. Проверьте дату и место в своих билетах.",
                )
                for uid in recipients
            ]
        )


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
    person = User.objects.filter(pass_token=token, is_active=True).first()
    if not person or not event.enrollments.filter(user=person).exists():
        raise FlowError(
            "NOT_REGISTERED", "Нет регистрации на это мероприятие. Вход не подтверждён"
        )
    return event, person


def check_in(user, event_id, raw):
    with schedule_write():
        event, person = attendee_by_qr(user, event_id, raw)
        entry, created = CheckIn.objects.get_or_create(
            user=person, event=event, defaults={"checked_by": user}
        )
        return person, entry, not created
