"""Narrow scanner capabilities, independent of permanent account roles."""

from hashlib import sha256
import secrets

from django.utils import timezone

from .contracts import FlowError
from .models import Activity, EventAccessKey, EventAccessUse, Webinar
from .services import owned_event, schedule_write


def target(user, event_id, activity_id=None, purpose="scan"):
    event = owned_event(event_id, user)
    activity = None
    if activity_id:
        activity = Activity.objects.filter(pk=activity_id, event=event).first()
        if activity is None:
            raise FlowError("NOT_FOUND", "Активность не найдена", 404)
    if purpose not in {"scan", "webinar"} or (purpose == "scan" and activity is not None) or (purpose == "webinar" and (activity is None or not activity.room.is_online)):
        raise FlowError("VALIDATION", "Сканер относится к мероприятию, ключ ведущего — к онлайн-флоу", 400)
    return event, activity


def revoke_records(keys):
    from .webinars import room_api, room_name
    for key in keys:
        key.revoked_at = timezone.now()
        key.save(update_fields=["revoked_at"])
        if key.purpose == "webinar":
            webinar = Webinar.objects.filter(activity_id=key.activity_id, active=True).first()
            if webinar:
                for user_id in key.uses.exclude(user_id=key.event.owner_id).values_list("user_id", flat=True):
                    try:
                        room_api("RemoveParticipant", room_name(webinar), identity=str(user_id))
                    except FlowError:
                        # Revocation persists even during a media-server outage;
                        # new tokens fail and the client disconnects on access polling.
                        pass


def issue_key(user, event_id, *, activity_id=None, purpose="scan"):
    with schedule_write():
        event, activity = target(user, event_id, activity_id, purpose)
        expires_at = min(event.ends_at, activity.ends_at if activity else event.ends_at)
        if expires_at <= timezone.now():
            raise FlowError("SCAN_CLOSED", "Встреча уже завершилась", 409)
        revoke_records(EventAccessKey.objects.filter(event=event, activity=activity, revoked_at__isnull=True))
        secret = secrets.token_urlsafe(32)
        key = EventAccessKey.objects.create(
            event=event, activity=activity, created_by=user,
            token_hash=sha256(secret.encode()).hexdigest(), expires_at=expires_at, purpose=purpose,
        )
        return key, secret


def revoke_key(user, event_id, *, activity_id=None, purpose="scan"):
    with schedule_write():
        event, activity = target(user, event_id, activity_id, purpose)
        revoke_records(EventAccessKey.objects.filter(event=event, activity=activity, revoked_at__isnull=True))


def resolve_key(user, secret, *, event_id=None, activity_id=None, purpose=None):
    if not user.is_authenticated or not user.is_active:
        raise FlowError("UNAUTHORIZED", "Войдите в аккаунт", 401)
    if not isinstance(secret, str) or not 32 <= len(secret) <= 128:
        raise FlowError("INVALID_SCAN_KEY", "Ключ недействителен или отозван", 403)
    key = EventAccessKey.objects.select_related("event", "activity__room", "created_by").filter(
        token_hash=sha256(secret.encode()).hexdigest(), revoked_at__isnull=True,
    ).first()
    if key is None or key.expires_at <= timezone.now() or key.event.ends_at <= timezone.now():
        raise FlowError("INVALID_SCAN_KEY", "Ключ недействителен или отозван", 403)
    if purpose is not None and key.purpose != purpose:
        raise FlowError("INVALID_SCAN_KEY", "Этот ключ предназначен для другого действия", 403)
    if key.created_by_id != key.event.owner_id or key.created_by.role != "organizer" or not key.created_by.is_active:
        raise FlowError("INVALID_SCAN_KEY", "Ключ недействителен или отозван", 403)
    if (event_id is not None and str(key.event_id) != str(event_id)) or (
        activity_id is not None and str(key.activity_id) != str(activity_id)
    ):
        raise FlowError("INVALID_SCAN_KEY", "Ключ не даёт доступ к этому сканеру", 403)
    if key.activity and (key.activity.event_id != key.event_id or key.activity.ends_at <= timezone.now()):
        raise FlowError("INVALID_SCAN_KEY", "Ключ недействителен или отозван", 403)
    if key.purpose == "webinar" and (key.activity is None or not key.activity.room.is_online):
        raise FlowError("INVALID_SCAN_KEY", "Ключ недействителен или отозван", 403)
    if key.event.status != "published":
        raise FlowError("SCAN_CLOSED", "Сканер доступен после публикации мероприятия", 409)
    return key


def record_use(key, user):
    EventAccessUse.objects.update_or_create(key=key, user=user, defaults={"last_used_at": timezone.now()})


def delegated_check_in(user, secret, raw_qr, activity_id=None):
    from .services import person_from_qr, mark_event_entry
    with schedule_write():
        key = resolve_key(user, secret, purpose="scan")
        person = person_from_qr(raw_qr)
        if person is None or not key.event.enrollments.filter(user=person).exists():
            raise FlowError("NOT_REGISTERED", "Нет регистрации на это мероприятие. Вход не подтверждён", 409)
        from .attendance import mark_activity_entry
        entry = mark_activity_entry(user, key.event, person, activity_id, access_key=key) if activity_id else mark_event_entry(user, key.event, person, access_key=key)
        record_use(key, user)
        return {"admitted": True, "already_checked_in": False,
                "checked_in_at": round(entry.created_at.timestamp()*1000),
                "attendee": {"id": person.pk, "name": person.name, "activities": []}}


def key_json(key):
    return {"id": key.pk, "purpose": key.purpose, "activity_id": key.activity_id,
            "created_at": round(key.created_at.timestamp()*1000),
            "expires_at": round(key.expires_at.timestamp()*1000), "users": key.uses.count()}


def management(user, event_id):
    event = owned_event(event_id, user)
    keys = {key.activity_id: key_json(key) for key in event.access_keys.filter(revoked_at__isnull=True, expires_at__gt=timezone.now())}
    return {"scan_key": keys.get(None), "activities": [
        {"id": activity.pk, "title": activity.title, "key": keys.get(activity.pk)}
        for activity in event.activities.filter(room__is_online=True)
    ]}
