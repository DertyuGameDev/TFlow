"""Webinar updates using the notification contract of the gosha branch."""
from django.db import transaction
from django.utils import timezone
from .mailing import create_notifications
from .models import ActivityAttendance, CheckIn, EventRegistration, Notification


def facts(event, activity=None):
    item = activity or event
    start = timezone.localtime(item.starts_at).strftime("%d.%m.%Y %H:%M")
    return f"«{item.title}», {start} МСК."


def broadcast_notice(event, activity=None, *, ended=False):
    people = EventRegistration.objects.filter(event=event)
    if activity is not None and activity.registration_required:
        people = people.filter(user__registrations__activity=activity)
    label = "Эфир завершён" if ended else "Эфир начался"
    return create_notifications([
        Notification(user_id=user_id, event=event, message=f"{label}. {facts(event, activity)}")
        for user_id in people.values_list("user_id", flat=True).distinct()
    ])


def online_attendance(user, event, activity=None):
    with transaction.atomic():
        _, event_created = CheckIn.objects.get_or_create(event=event, user=user, defaults={"source": "webinar"})
        activity_created = False
        if activity is not None:
            _, activity_created = ActivityAttendance.objects.get_or_create(activity=activity, user=user, defaults={"source": "webinar"})
        if activity_created or (event_created and activity is None):
            create_notifications([Notification(user=user, event=event, message=f"Подключение к эфиру подтверждено. {facts(event, activity)}")])
