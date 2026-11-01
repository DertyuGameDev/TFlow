"""Transactional timeline editing. No activity with real data is silently replaced."""

import hashlib
import json
from datetime import timedelta

from django.core import signing
from django.utils import timezone

from .access_keys import sync_key_expiry
from .contracts import FlowError, MillisecondsField
from .models import (
    Activity,
    Event,
    HttpBroadcast,
    Registration,
    User,
    WaitlistEntry,
    Webinar,
)
from .notifications import activity_facts, notify_audience
from .program_schedule import swapped_ranges
from .schedule_feedback import change_message, snapshot
from .serializers import milliseconds
from .services import (
    owned_event,
    promote_waitlist_locked,
    retry_user_waitlists_locked,
    schedule_write,
    validate_activity,
)

SALT = "tflow-program-undo-v2"
MINUTE = timedelta(minutes=1)
META = ["title", "description", "speaker", "capacity", "registration_required"]


def state(activity):
    return {
        **{k: getattr(activity, k) for k in META},
        "id": activity.pk,
        "room_id": activity.room_id,
        "starts_at": milliseconds(activity.starts_at),
        "ends_at": milliseconds(activity.ends_at),
    }


def relations(activity):
    data = {
        "registrations": list(
            activity.registrations.order_by("user_id").values_list(
                "user_id", "created_at"
            )
        ),
        "waitlist": list(
            activity.waitlist.order_by("id").values_list("user_id", "created_at")
        ),
        "attendance": activity.attendance.count(),
        "uses": sum(k.uses.count() for k in activity.access_keys.all()),
        "messages": sum(
            b.messages.count() for b in HttpBroadcast.objects.filter(activity=activity)
        ),
    }
    return hashlib.sha256(
        json.dumps(data, default=str, sort_keys=True).encode()
    ).hexdigest()


def instant(value):
    try:
        return MillisecondsField().clean(value)
    except Exception as error:
        raise FlowError(
            "VALIDATION", "Укажите корректное время на графике", 400
        ) from error


def edit_program(user, event_id, data):
    with schedule_write():
        event = owned_event(event_id, user)
        revision = data.get("expected_event_updated_at")
        if isinstance(revision, bool) or revision != milliseconds(event.updated_at):
            raise FlowError(
                "STALE_PROGRAM",
                "Программа уже изменилась. Обновите её и повторите действие",
            )
        items = list(
            Activity.objects.select_for_update(of=("self",))
            .filter(event=event)
            .select_related("event", "room")
            .order_by("starts_at", "id")
        )
        previous = {a.pk: snapshot(a) for a in items}
        by_id = {a.pk: a for a in items}
        before = [state(a) for a in items]
        created = []
        deleted = []
        operation = data.get("operation")
        if operation not in {"move", "insert", "copy", "split", "swap", "undo"}:
            raise FlowError("VALIDATION", "Неизвестное действие на графике", 400)

        def get(key):
            value = data.get(key)
            if not isinstance(value, str) or value not in by_id:
                raise FlowError("NOT_FOUND", "Пункт программы не найден", 404)
            return by_id[value]

        def clone(source, start, end, participants=False):
            item = Activity(
                event=event,
                room_id=source.room_id,
                starts_at=start,
                ends_at=end,
                **{k: getattr(source, k) for k in META},
            )
            if participants:
                item.title = source.title + " · часть 2"
            else:
                item.title = source.title + " · копия"
            item.save()
            items.append(item)
            by_id[item.pk] = item
            created.append(item)
            if participants:
                Registration.objects.bulk_create(
                    [
                        Registration(
                            activity=item, user_id=r.user_id, created_at=r.created_at
                        )
                        for r in source.registrations.all()
                    ]
                )
                WaitlistEntry.objects.bulk_create(
                    [
                        WaitlistEntry(
                            activity=item, user_id=r.user_id, created_at=r.created_at
                        )
                        for r in source.waitlist.order_by("id")
                    ]
                )
            return item

        if operation == "undo":
            try:
                undo = signing.loads(data.get("undo", ""), salt=SALT, max_age=3600)
            except (signing.BadSignature, TypeError, ValueError):
                raise FlowError(
                    "UNDO_EXPIRED", "Отмена недоступна. Программа не изменена", 409
                ) from None
            if (
                undo.get("event") != event.pk
                or undo.get("owner") != user.pk
                or undo.get("after") != before
            ):
                raise FlowError(
                    "STALE_PROGRAM",
                    "Программа изменилась после этого действия. Автоматическая отмена небезопасна",
                )
            for key, digest in undo.get("participants", {}).items():
                if relations(by_id[key]) != digest:
                    raise FlowError(
                        "UNDO_HAS_DATA",
                        "Состав участников или посещения изменились после разрезания. Автоматическая отмена небезопасна",
                    )
            for key, digest in undo.get("created", {}).items():
                item = by_id[key]
                if relations(item) != digest:
                    raise FlowError(
                        "UNDO_HAS_DATA",
                        "У новой части появились записи или посещения. Удалять её при отмене нельзя",
                    )
                deleted.append(item)
            old = {row["id"]: row for row in undo["before"]}
            for item in items:
                if item.pk in old:
                    row = old[item.pk]
                    item.room_id = row["room_id"]
                    item.starts_at = instant(row["starts_at"])
                    item.ends_at = instant(row["ends_at"])
        else:
            source = get("activity_id")
            if operation == "move":
                source.starts_at = instant(data.get("starts_at"))
                source.ends_at = instant(data.get("ends_at"))
                source.room_id = data.get("room_id") or source.room_id
            elif operation == "split":
                at = instant(data.get("at"))
                if at - source.starts_at < MINUTE or source.ends_at - at < MINUTE:
                    raise FlowError(
                        "SPLIT_TOO_SHORT",
                        "С каждой стороны разреза должна остаться хотя бы минута",
                    )
                clone(source, at, source.ends_at, True)
                source.ends_at = at
            elif operation == "swap":
                target = get("target_id")
                if target.pk == source.pk:
                    raise FlowError("VALIDATION", "Выберите другой пункт", 400)
                if target.room_id == source.room_id:
                    for item, start, end in swapped_ranges(source, target):
                        current = by_id[item.pk]
                        current.starts_at = start
                        current.ends_at = end
                else:
                    start, room, duration = (
                        source.starts_at,
                        source.room_id,
                        source.ends_at - source.starts_at,
                    )
                    source.starts_at, source.ends_at, source.room_id = (
                        target.starts_at,
                        target.starts_at + duration,
                        target.room_id,
                    )
                    target.starts_at, target.ends_at, target.room_id = (
                        start,
                        start + (target.ends_at - target.starts_at),
                        room,
                    )
            else:
                target = get("target_id") if data.get("target_id") else None
                if target and target.pk == source.pk and operation != "copy":
                    raise FlowError(
                        "VALIDATION", "Нельзя вставить пункт внутрь самого себя", 400
                    )
                offset = None
                if target and data.get("position") == "inside":
                    offset = instant(data.get("at")) - target.starts_at
                    if (
                        offset < MINUTE
                        or target.ends_at - target.starts_at - offset < MINUTE
                    ):
                        raise FlowError(
                            "SPLIT_TOO_SHORT",
                            "Для вставки внутрь оставьте хотя бы минуту с каждой стороны",
                        )
                duration = source.ends_at - source.starts_at
                if operation == "copy":
                    source = clone(source, source.starts_at, source.ends_at)
                elif target:
                    # Ripple-close the source slot; preserve gaps and the length of every other item.
                    boundary = source.ends_at
                    for item in items:
                        if (
                            item.pk != source.pk
                            and item.room_id == source.room_id
                            and item.starts_at >= boundary
                        ):
                            item.starts_at -= duration
                            item.ends_at -= duration
                room = (
                    target.room_id if target else data.get("room_id") or source.room_id
                )
                at = (
                    (
                        target.starts_at + offset
                        if offset is not None
                        else target.ends_at
                        if data.get("position") == "after"
                        else target.starts_at
                    )
                    if target
                    else instant(data.get("at"))
                )
                if target and offset is not None:
                    clone(target, at, target.ends_at, True)
                    target.ends_at = at
                # Ripple insert: move following items together; free-space paste leaves the program untouched.
                if target:
                    for item in items:
                        if (
                            item.pk != source.pk
                            and item.room_id == room
                            and item.starts_at >= at
                        ):
                            item.starts_at += duration
                            item.ends_at += duration
                source.room_id, source.starts_at, source.ends_at = (
                    room,
                    at,
                    at + duration,
                )
        old_by_id = {row["id"]: row for row in before}
        changed = [
            a for a in items if a not in deleted and state(a) != old_by_id.get(a.pk)
        ]
        changed_ids = {a.pk for a in [*changed, *deleted]}
        if (
            HttpBroadcast.objects.filter(
                activity_id__in=changed_ids, active=True
            ).exists()
            or Webinar.objects.filter(activity_id__in=changed_ids, active=True).exists()
        ):
            raise FlowError(
                "WEBINAR_ACTIVE",
                "Сначала завершите эфир изменяемой активности. Программа не изменена",
            )
        for item in deleted:
            item.delete()
        stamp = max(timezone.now(), event.updated_at + timedelta(milliseconds=1))
        for item in changed:
            if item.ends_at - item.starts_at < MINUTE:
                raise FlowError(
                    "INVALID_DURATION",
                    "Длительность пункта должна быть не меньше минуты",
                )
            item.updated_at = stamp
        Activity.objects.bulk_update(
            changed, ["room_id", "starts_at", "ends_at", "updated_at"]
        )
        for item in changed:
            validate_activity(item)
        if changed or deleted:
            Event.objects.filter(pk=event.pk).update(updated_at=stamp)
            for item in changed:
                promote_waitlist_locked(item)
            for person in User.objects.filter(
                registrations__activity_id__in=changed_ids
            ).distinct():
                retry_user_waitlists_locked(person)
            sync_key_expiry(event)
            details = "\n".join(
                change_message(a, previous[a.pk])
                if a.pk in previous
                else activity_facts(a)
                for a in changed[:12]
            )
            if deleted:
                details += "\nУдалены созданные части: " + ", ".join(
                    a.title for a in deleted
                )
            labels = {
                "move": "Активность перенесена",
                "insert": "Изменён порядок программы",
                "copy": "Добавлена копия активности",
                "split": "Активность разделена на части",
                "swap": "Активности поменяли местами",
                "undo": "Изменение программы отменено",
            }
            notify_audience(
                event, labels[operation] + ".\n" + details, title=labels[operation]
            )
        after = [
            state(a)
            for a in Activity.objects.filter(event=event).order_by("starts_at", "id")
        ]
        token = (
            signing.dumps(
                {
                    "event": event.pk,
                    "owner": user.pk,
                    "before": before,
                    "after": after,
                    "created": {a.pk: relations(a) for a in created},
                    "participants": {a.pk: relations(a) for a in changed}
                    if created
                    else {},
                },
                salt=SALT,
                compress=True,
            )
            if operation != "undo" and before != after
            else None
        )
        return {"ok": True, "undo": token, "created_ids": [a.pk for a in created]}
