from datetime import timedelta
from django.utils import timezone
from .mailing import create_notifications
from .models import ActivityReminder, Notification, Registration
from .schedule_feedback import stamp
from .services import schedule_write


def send_due_reminders(now=None):
    now = now or timezone.now()
    sent = 0
    with schedule_write():
        registrations = Registration.objects.select_related('activity__room', 'activity__event').filter(
            activity__event__status='published', activity__starts_at__gt=now,
            activity__starts_at__lte=now + timedelta(minutes=30), user__is_active=True,
            user__role='participant',
        )
        for registration in registrations:
            activity = registration.activity
            _, created = ActivityReminder.objects.get_or_create(user_id=registration.user_id, activity=activity, starts_at=activity.starts_at)
            if created:
                create_notifications([Notification(user_id=registration.user_id, event=activity.event, activity=activity, kind="activity_reminder",
                    message=f'Скоро начнётся «{activity.title}»: {stamp(activity.starts_at)} МСК, {activity.room.name}. Откройте своё расписание.')])
                sent += 1
    return sent
