"""Atomic changes of program order, with durations and gaps preserved."""

from django.db import transaction
from django.utils import timezone

from .contracts import FlowError
from .notifications import create_notifications
from .models import Activity, Event, Notification, User
from .schedule_feedback import snapshot, change_message
from .serializers import milliseconds
from .services import (
    owned_event, promote_waitlist_locked, retry_user_waitlists_locked,
    schedule_write, validate_activity,
)


def swapped_ranges(first, second):
    """Return activity objects and their proposed intervals, without writing."""
    if first.room_id != second.room_id:
        return [
            (first, second.starts_at, second.starts_at + (first.ends_at - first.starts_at)),
            (second, first.starts_at, first.starts_at + (second.ends_at - second.starts_at)),
        ]
    first, second = sorted([first, second], key=lambda a: (a.starts_at, a.pk))
    track = list(Activity.objects.filter(
        event_id=first.event_id, room_id=first.room_id,
        starts_at__gte=first.starts_at, starts_at__lte=second.starts_at,
    ).select_related("event").order_by("starts_at", "id"))
    gaps = [b.starts_at - a.ends_at for a, b in zip(track, track[1:])]
    if any(gap.total_seconds() < 0 for gap in gaps):
        raise FlowError("ROOM_CONFLICT", "В аудитории уже есть пересечения. Сначала исправьте время пунктов")
    order = [track[-1], *track[1:-1], track[0]]
    cursor = track[0].starts_at
    result = []
    for index, activity in enumerate(order):
        duration = activity.ends_at - activity.starts_at
        result.append((activity, cursor, cursor + duration))
        cursor += duration
        if index < len(gaps):
            cursor += gaps[index]
    return result


def swap_activities(user, activity_id, other_id, expected_event_updated_at=None, preview=False):
    with schedule_write():
        try:
            first = Activity.objects.select_related("event").get(pk=activity_id)
        except Activity.DoesNotExist as error:
            raise FlowError("NOT_FOUND", "Пункт программы не найден", 404) from error
        event = owned_event(first.event_id, user)
        if expected_event_updated_at is not None and expected_event_updated_at != milliseconds(event.updated_at):
            raise FlowError("STALE_PROGRAM", "Программа уже изменилась. Обновите её и повторите обмен")
        if activity_id == other_id:
            raise FlowError("VALIDATION", "Выберите другой пункт программы", 400)
        try:
            second = Activity.objects.select_related("event").get(pk=other_id, event=event)
        except Activity.DoesNotExist as error:
            raise FlowError("INVALID_REFERENCE", "Выберите пункт этого же мероприятия", 400) from error
        proposed = swapped_ranges(first, second)
        stamp = timezone.now()
        changes, activities = [], []
        previous = {a.pk: snapshot(a) for a, _, _ in proposed}
        for activity, start, end in proposed:
            if (activity.starts_at, activity.ends_at) == (start, end):
                continue
            changes.append({
                "id": activity.pk, "title": activity.title,
                "before": {"starts_at": milliseconds(activity.starts_at), "ends_at": milliseconds(activity.ends_at)},
                "after": {"starts_at": milliseconds(start), "ends_at": milliseconds(end)},
            })
            activity.starts_at, activity.ends_at, activity.updated_at = start, end, stamp
            activities.append(activity)
        # All new ranges become visible together only after the transaction
        # commits. Validation sees the final schedule, including shifted items.
        Activity.objects.bulk_update(activities, ["starts_at", "ends_at", "updated_at"])
        for activity in activities:
            validate_activity(activity)
        if preview:
            transaction.set_rollback(True)
            return {"ok": True, "preview": True, "changes": changes}
        if activities:
            Event.objects.filter(pk=event.pk).update(updated_at=stamp)
            affected_users = set()
            for activity in activities:
                users = set(activity.registrations.values_list("user_id", flat=True))
                affected_users |= users
                recipients = users | set(activity.waitlist.values_list("user_id", flat=True))
                create_notifications([
                    Notification(user_id=uid, event_id=event.pk, activity=activity,
                                 message=change_message(activity, previous[activity.pk]))
                    for uid in recipients
                ])
                promote_waitlist_locked(activity)
            for participant in User.objects.filter(pk__in=affected_users):
                retry_user_waitlists_locked(participant)
        return {"ok": True, "preview": False, "changes": changes}
