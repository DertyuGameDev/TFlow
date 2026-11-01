"""Activity attendance is distinct from the event admission checkpoint."""
from django.utils import timezone
from .contracts import FlowError
from .models import Activity, ActivityAttendance, CheckIn, Registration


def mark_activity_entry(user, event, person, activity_id, access_key=None):
    activity = Activity.objects.filter(pk=activity_id, event=event).first()
    if not activity:
        raise FlowError("NOT_FOUND", "Флоу не принадлежит этому мероприятию", 404)
    if event.status != "published" or activity.ends_at <= timezone.now():
        raise FlowError("SCAN_CLOSED", "Флоу завершён или мероприятие не опубликовано", 409)
    if activity.registration_required and not Registration.objects.filter(user=person, activity=activity).exists():
        raise FlowError("NOT_REGISTERED", "Нет регистрации на выбранный флоу. Посещение не подтверждено", 409)
    entry, created = ActivityAttendance.objects.get_or_create(user=person, activity=activity,
        defaults={"checked_by": user, "access_key": access_key})
    if not created:
        raise FlowError("ALREADY_CHECKED_IN", "Посещение этого флоу уже отмечено", 409)
    CheckIn.objects.get_or_create(user=person, event=event, defaults={"checked_by": user, "access_key": access_key})
    from .notifications import personal_notice, activity_facts
    personal_notice(person, event, "Посещение активности по QR подтверждено. " + activity_facts(activity), title="Вы вошли на активность", activity=activity, kind="attendance")
    return entry
