from contextlib import contextmanager
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from .contracts import FlowError
from .models import Activity, Community, Event, Notification, Registration, Room, ScheduleLock


@contextmanager
def schedule_write():
    # IMMEDIATE acquires the SQLite write lock before validation. PostgreSQL uses
    # this singleton row to serialize writes across events and user schedules.
    # Every operation that can affect the schedule must take this same lock.
    with transaction.atomic():
        ScheduleLock.objects.select_for_update().get(pk=1)
        yield


def owned_event(event_id, user):
    try:
        event = Event.objects.get(pk=event_id)
    except Event.DoesNotExist as error:
        raise FlowError("NOT_FOUND", "Мероприятие не найдено", 404) from error
    if event.owner_id != user.pk:
        raise FlowError("FORBIDDEN", "Управлять программой может только организатор этого мероприятия", 403)
    return event


def check_community(data):
    if data.get("community_id") and not Community.objects.filter(pk=data["community_id"]).exists():
        raise FlowError("INVALID_REFERENCE", "Сообщество не найдено", 400)


def create_event(user, data):
    with schedule_write():
        check_community(data)
        return Event.objects.create(owner=user, **data)


def update_event(user, event_id, data):
    with schedule_write():
        event = owned_event(event_id, user)
        check_community(data)
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
        if not event.activities.exists():
            raise FlowError("EMPTY_PROGRAM", "Перед публикацией добавьте хотя бы одну активность", 400)
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
                for uid in activity.registrations.values_list("user_id", flat=True)
            ])
        return activity


def register(user, activity_id):
    with schedule_write():
        try:
            activity = Activity.objects.select_related("event").get(pk=activity_id)
        except Activity.DoesNotExist as error:
            raise FlowError("NOT_FOUND", "Активность не найдена", 404) from error
        if Registration.objects.filter(user=user, activity=activity).exists():
            raise FlowError("ALREADY_REGISTERED", "Вы уже записаны на эту активность")
        if activity.event.status != "published":
            raise FlowError("NOT_PUBLISHED", "Регистрация на неопубликованную программу недоступна")
        if activity.starts_at <= timezone.now():
            raise FlowError("REGISTRATION_CLOSED", "Регистрация закрыта: активность уже началась")
        if activity.registrations.count() >= activity.capacity:
            raise FlowError("NO_SEATS", "Свободные места закончились. Выберите другую активность")
        if Registration.objects.filter(user=user, activity__starts_at__lt=activity.ends_at, activity__ends_at__gt=activity.starts_at).exists():
            raise FlowError("PARTICIPANT_CONFLICT", "Это время занято другой активностью в вашем расписании")
        Registration.objects.create(user=user, activity=activity)


def cancel(user, activity_id):
    with schedule_write():
        Registration.objects.filter(user=user, activity_id=activity_id).delete()
