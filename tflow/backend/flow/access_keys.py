"""Scoped webinar presenter links, independent of permanent account roles."""

from hashlib import sha256

from django.utils import timezone

from .contracts import FlowError
from .models import EventAccessKey, EventAccessUse, Webinar
from .services import owned_event, schedule_write


def revoke_records(keys):
    from .webinars import room_api, room_name
    for key in keys:
        key.revoked_at = timezone.now()
        key.save(update_fields=["revoked_at"])
        if key.purpose == "webinar":
            from .models import HttpBroadcast
            HttpBroadcast.objects.filter(publisher_key=key, active=True).update(active=False, publisher_hash="")
            webinar = Webinar.objects.filter(activity_id=key.activity_id, active=True).first()
            if webinar:
                for user_id in key.uses.exclude(user_id=key.event.owner_id).values_list("user_id", flat=True):
                    try:
                        room_api("RemoveParticipant", room_name(webinar), identity=str(user_id))
                    except FlowError:
                        # Revocation persists even during a media-server outage;
                        # new tokens fail and the client disconnects on access polling.
                        pass


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
        raise FlowError("INVALID_SCAN_KEY", "Ссылка не даёт доступ к этому эфиру", 403)
    if key.activity and (key.activity.event_id != key.event_id or key.activity.ends_at <= timezone.now()):
        raise FlowError("INVALID_SCAN_KEY", "Ключ недействителен или отозван", 403)
    if key.purpose == "webinar" and (key.activity is None or not key.activity.room.is_online):
        raise FlowError("INVALID_SCAN_KEY", "Ключ недействителен или отозван", 403)
    if key.event.status != "published":
        raise FlowError("SCAN_CLOSED", "Эфир доступен после публикации мероприятия", 409)
    return key


def record_use(key, user):
    EventAccessUse.objects.update_or_create(key=key, user=user, defaults={"last_used_at": timezone.now()})


def invitation_secret(key):
    from django.utils.crypto import salted_hmac
    return salted_hmac('tflow-lecturer-invite-v1', key.pk, algorithm='sha256').hexdigest()


def lecturer_links(user, event_id, *, activity_id=None, operation='ensure'):
    """Idempotent owner-only link provisioning, never a mutation on GET."""
    with schedule_write():
        event = owned_event(event_id, user)
        if operation not in {'ensure', 'issue', 'revoke'}:
            raise FlowError('VALIDATION', 'Неизвестное действие', 400)
        activities = event.activities.filter(room__is_online=True).select_related('room')
        if activity_id:
            activities = activities.filter(pk=activity_id)
            if not activities.exists(): raise FlowError('NOT_FOUND', 'Онлайн-активность не найдена', 404)
        elif operation != 'ensure': raise FlowError('VALIDATION', 'Выберите активность', 400)
        result=[]
        for activity in activities:
            history=EventAccessKey.objects.filter(activity=activity,is_link=True)
            key=history.filter(revoked_at__isnull=True).first()
            if operation in {'issue','revoke'}:
                revoke_records(EventAccessKey.objects.filter(activity=activity,revoked_at__isnull=True))
                key=None
            if activity.ends_at>timezone.now() and operation!='revoke' and (operation=='issue' or not history.exists()):
                key=EventAccessKey(event=event,activity=activity,created_by=user,purpose='webinar',is_link=True,expires_at=min(event.ends_at,activity.ends_at))
                key.token_hash=sha256(invitation_secret(key).encode()).hexdigest();key.save()
            result.append({'id':activity.pk,'title':activity.title,'starts_at':round(activity.starts_at.timestamp()*1000),'ends_at':round(activity.ends_at.timestamp()*1000),'key_id':key.pk if key else None,'credential':invitation_secret(key) if key else None})
        return {'activities':result}


def sync_key_expiry(event):
    keys=list(EventAccessKey.objects.filter(event=event,revoked_at__isnull=True).select_related('activity'))
    for key in keys:key.expires_at=min(event.ends_at,key.activity.ends_at if key.activity else event.ends_at)
    EventAccessKey.objects.bulk_update(keys,['expires_at'])
