from django.db import transaction
from django.db.models import Q
from .contracts import FlowError
from .models import Notification, User, Membership, Registration, WaitlistEntry, PushSubscription, PushDelivery
from .serializers import notice_json


def notification_page(user, *, before=None, unread=False):
    notices = user.notifications.all()
    if before:
        try:
            cursor = notices.get(pk=before)
        except Notification.DoesNotExist as error:
            raise FlowError("NOT_FOUND", "Уведомление не найдено", 404) from error
        notices = notices.filter(
            Q(created_at__lt=cursor.created_at)
            | Q(created_at=cursor.created_at, pk__gt=cursor.pk)
        )
    if unread:
        notices = notices.filter(read=False)
    page = list(notices[:21])
    return {
        "items": [notice_json(notice) for notice in page[:20]],
        "next_cursor": page[19].pk if len(page) > 20 else None,
    }


def create_notifications(notices):
    """Persist site notifications in the caller's business transaction."""
    if not notices:
        return []
    for notice in notices:
        notice.title = notice.title[:200]
        if len(notice.message) > 6000:
            notice.message = notice.message[:5940] + "… Полные сведения — в карточке события."
    with transaction.atomic():
        saved = Notification.objects.bulk_create(notices, batch_size=500)
        from django.conf import settings
        if getattr(settings, "WEB_PUSH_ENABLED", False):
            users = {n.user_id for n in saved}
            subscriptions = {}
            for device in PushSubscription.objects.filter(user_id__in=users, enabled=True):
                subscriptions.setdefault(device.user_id, []).append(device)
            PushDelivery.objects.bulk_create([
                PushDelivery(notification=n, subscription=d, generation=d.generation)
                for n in saved for d in subscriptions.get(n.user_id, [])
            ], batch_size=500)
        return saved


def event_recipients(event, *, include_subscribers=True):
    """A ticket, a queue or an explicit club subscription grants update delivery."""
    users = set(event.enrollments.values_list("user_id", flat=True))
    users.update(event.waitlist_entries.values_list("user_id", flat=True))
    users.update(event.check_ins.values_list("user_id", flat=True))
    users.update(Registration.objects.filter(activity__event=event).values_list("user_id", flat=True))
    users.update(WaitlistEntry.objects.filter(activity__event=event).values_list("user_id", flat=True))
    if include_subscribers and event.community_id:
        users.update(Membership.objects.filter(community_id=event.community_id, notify_events=True).values_list("user_id", flat=True))
    return set(User.objects.filter(pk__in=users, is_active=True).exclude(pk=event.owner_id).values_list("pk", flat=True))


def notify_audience(event, message, *, title="Изменения в мероприятии", activity=None, kind="info", data=None, recipients=None):
    if event.status != "published":
        return []
    recipients = event_recipients(event) if recipients is None else recipients
    return create_notifications([Notification(user_id=uid, event=event, activity=activity, kind=kind,
        title=title, message=message, data=data or {}) for uid in sorted(set(recipients))])


def personal_notice(user, event, message, *, title, activity=None, kind="registration"):
    return create_notifications([Notification(user=user, event=event, activity=activity,
        kind=kind, title=title, message=message)])


def event_facts(event):
    from .schedule_feedback import stamp, interval
    location = ", ".join(filter(None, [event.city, event.venue, event.address]))
    return f"«{event.title}». {interval(event.starts_at, event.ends_at)} МСК. {event.format}: {location or 'Место уточняется'}."


def activity_facts(activity):
    from .schedule_feedback import interval
    return f"«{activity.title}», мероприятие «{activity.event.title}». {interval(activity.starts_at, activity.ends_at)} МСК. Аудитория: {activity.room.name}." + (f" Спикер: {activity.speaker}." if activity.speaker else "")


def broadcast_notice(event, activity=None, *, ended=False):
    label = "Эфир завершён" if ended else "Эфир начался"
    return notify_audience(event, label + ". " + (activity_facts(activity) if activity else event_facts(event)),
        title=label, activity=activity, kind="webinar")


def online_attendance(user, event, activity=None):
    """One durable confirmation on first actual media delivery, never per segment."""
    from .models import CheckIn, ActivityAttendance
    with transaction.atomic():
        _, event_created = CheckIn.objects.get_or_create(event=event, user=user, defaults={"source": "webinar"})
        activity_created = False
        if activity:
            _, activity_created = ActivityAttendance.objects.get_or_create(activity=activity, user=user, defaults={"source": "webinar"})
        if activity_created or (event_created and not activity):
            personal_notice(user, event, "Подключение к эфиру подтверждено. " + (activity_facts(activity) if activity else event_facts(event)),
                title="Онлайн-посещение подтверждено", activity=activity, kind="attendance")
