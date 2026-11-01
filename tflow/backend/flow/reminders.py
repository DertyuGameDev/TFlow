"""Durable, idempotent reminders keyed by the current scheduled start."""
from datetime import timedelta
from django.utils import timezone
from .notifications import create_notifications, event_facts, activity_facts
from .models import ActivityReminder, EventRegistration, Notification, Registration, ScheduledNotice
from .services import schedule_write


def send_due_reminders(now=None):
    now = now or timezone.now()
    notices = []
    with schedule_write():
        # Keep the established activity reminder key so upgrades do not resend it.
        registrations = Registration.objects.select_related('activity__room', 'activity__event').filter(
            activity__event__status='published', activity__starts_at__gt=now,
            activity__starts_at__lte=now + timedelta(minutes=30), user__is_active=True,
            user__role='participant',
        )
        for registration in registrations:
            a = registration.activity
            _, created = ActivityReminder.objects.get_or_create(user_id=registration.user_id, activity=a, starts_at=a.starts_at)
            if created:
                notices.append(Notification(user_id=registration.user_id, event=a.event, activity=a, kind="activity_reminder",
                    title="Скоро начнётся активность", message=activity_facts(a), data={"starts_at":a.starts_at.isoformat()}))
        # Event reminders: tomorrow, in half an hour, and at the beginning.
        tickets = EventRegistration.objects.select_related('event').filter(event__status='published',
            event__starts_at__lte=now+timedelta(days=1), event__ends_at__gt=now,
            event__starts_at__gte=now-timedelta(minutes=5), user__is_active=True, user__role='participant')
        for ticket in tickets:
            e = ticket.event
            remaining = (e.starts_at-now).total_seconds()
            offset = 1440 if remaining > 1800 else 30 if remaining > 0 else 0
            # Joining after the day-before checkpoint is already covered by the ticket confirmation.
            if offset == 1440 and ticket.created_at > e.starts_at-timedelta(days=1): continue
            _, created = ScheduledNotice.objects.get_or_create(user_id=ticket.user_id, event=e,
                scope='event:'+e.pk, starts_at=e.starts_at, offset=offset)
            if created:
                notices.append(Notification(user_id=ticket.user_id,event=e,kind='event_reminder',
                    title='Мероприятие начинается' if offset==0 else 'Напоминание о мероприятии',
                    message=event_facts(e),data={"starts_at":e.starts_at.isoformat(),"offset":offset}))
        for registration in Registration.objects.select_related('activity__room','activity__event').filter(
            activity__event__status='published', activity__starts_at__lte=now,
            activity__starts_at__gte=now-timedelta(minutes=5), activity__ends_at__gt=now,
            user__is_active=True, user__role='participant'):
            a=registration.activity
            _,created=ScheduledNotice.objects.get_or_create(user_id=registration.user_id,event=a.event,activity=a,
                scope='activity:'+a.pk,starts_at=a.starts_at,offset=0)
            if created:
                notices.append(Notification(user_id=registration.user_id,event=a.event,activity=a,kind='activity_reminder',
                    title='Активность начинается',message=activity_facts(a),data={"starts_at":a.starts_at.isoformat(),"offset":0}))
        create_notifications(notices)
    return len(notices)
