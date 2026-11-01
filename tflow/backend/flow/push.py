"""Authenticated device subscriptions and leased, retryable Web Push delivery."""
import base64
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
import json
import time
from pathlib import Path
from urllib.parse import urlsplit
import uuid

from django.conf import settings
from django.db import transaction
from django.db.models import Q
from django.http import JsonResponse
from django.utils import timezone
from .contracts import FlowError
from .models import Notification, PushDelivery, PushSubscription
from .serializers import notice_json

COOKIE = "tflow_push_device"


def decode_key(value, length):
    if not isinstance(value, str) or len(value) > 120:
        raise ValueError()
    result = base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))
    if len(result) != length:
        raise ValueError()
    return result


def validate_subscription(value):
    try:
        if not isinstance(value, dict): raise ValueError()
        endpoint = value["endpoint"]
        if not isinstance(endpoint, str) or len(endpoint) > 2048: raise ValueError()
        url = urlsplit(endpoint)
        host = url.hostname or ""
        allowed = host in {"fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com"} or (host.endswith(".notify.windows.com") and host.count(".") >= 3)
        if not allowed or url.scheme != "https" or url.port not in {None, 443} or url.username is not None or url.fragment or not url.path: raise ValueError()
        keys = value["keys"]
        if decode_key(keys["p256dh"], 65)[0] != 4: raise ValueError()
        decode_key(keys["auth"], 16)
        # Validate that it is an actual P-256 curve point, not only a sized blob.
        from cryptography.hazmat.primitives.asymmetric import ec
        ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), decode_key(keys["p256dh"], 65))
        return endpoint, {k: keys[k] for k in ("p256dh", "auth")}
    except (KeyError, ValueError, TypeError, UnicodeError):
        raise FlowError("INVALID_PUSH_SUBSCRIPTION", "Браузер передал некорректную подписку. Включите уведомления заново", 400) from None


def configured():
    return settings.WEB_PUSH_ENABLED and Path(settings.WEB_PUSH_PRIVATE_KEY).is_file() and bool(public_key())


def public_key():
    try: return Path(settings.WEB_PUSH_PUBLIC_KEY).read_text().strip()
    except OSError: return ""


def worker_ready():
    try: return time.time() - (Path(settings.NOTIFICATION_WORKER_ROOT) / "worker").stat().st_mtime < 90
    except OSError: return False


def device_for(request):
    return PushSubscription.objects.filter(pk=request.COOKIES.get(COOKIE, ""), user=request.user, enabled=True).first()


def config(request):
    device = device_for(request)
    return JsonResponse({"configured": configured(), "ready": worker_ready(), "publicKey": public_key(),
                         "deviceEnabled": bool(device)})


def subscribe(request, value):
    if not configured(): raise FlowError("PUSH_UNAVAILABLE", "Push-сервис пока недоступен. Уведомления на сайте сохраняются", 503)
    endpoint, keys = validate_subscription(value)
    with transaction.atomic():
        device = PushSubscription.objects.select_for_update().filter(endpoint=endpoint).first()
        changed = not device or device.user_id != request.user.pk or device.keys != keys or not device.enabled
        if (not device or device.user_id != request.user.pk or not device.enabled) and request.user.push_subscriptions.filter(enabled=True).count() >= 10:
            raise FlowError("PUSH_DEVICE_LIMIT", "Подключено 10 устройств. Сначала отключите уведомления на одном из них", 409)
        if not device:
            device = PushSubscription(user=request.user, endpoint=endpoint, keys=keys)
        elif changed:
            device.deliveries.filter(status="pending").update(status="skipped", last_error="DEVICE_REBOUND", lease_until=None)
            device.generation = uuid.uuid4()
        device.user, device.keys, device.enabled, device.updated_at = request.user, keys, True, timezone.now()
        device.save()
        if changed:
            from .notifications import personal_notice
            personal_notice(request.user, None, "Push-уведомления подключены на этом устройстве. Изменения мероприятий, записи и напоминания будут приходить и при закрытой вкладке.", title="Push-уведомления подключены", kind="info")
    response = JsonResponse({"ok": True, "enabled": True})
    response.set_cookie(COOKIE, device.pk, max_age=31536000, secure=not settings.DEBUG, httponly=True, samesite="Lax")
    return response


def detach(request):
    if request.user.is_authenticated:
        PushSubscription.objects.filter(pk=request.COOKIES.get(COOKIE, ""), user=request.user).delete()


def unsubscribe(request):
    detach(request)
    response = JsonResponse({"ok": True})
    response.delete_cookie(COOKIE, samesite="Lax")
    return response


def test_push(request):
    device = device_for(request)
    if not device: raise FlowError("PUSH_NOT_ENABLED", "Сначала включите push на этом устройстве", 409)
    if request.user.notifications.filter(data__push_test=True, created_at__gt=timezone.now()-timedelta(minutes=1)).exists():
        raise FlowError("TOO_MANY_REQUESTS", "Тест можно отправлять раз в минуту", 429)
    from .notifications import create_notifications
    create_notifications([Notification(user=request.user, title="Проверка уведомлений", message="Это тестовое push-уведомление ТФлоу. Откройте его, чтобы перейти в центр уведомлений.", data={"push_test": True})])
    return JsonResponse({"ok": True, "queued": True})


def summary(user):
    newest = user.notifications.first()
    return {"latest": notice_json(newest) if newest else None, "unread_count": user.notifications.filter(read=False).count()}


def deliver(job_id):
    """The network call is outside every business/schedule transaction."""
    from django.db import close_old_connections
    close_old_connections()
    try:
        job = PushDelivery.objects.select_related("subscription__user", "notification__event", "notification__activity").filter(pk=job_id).first()
        if not job: return
        device, notice = job.subscription, job.notification
        if not device.enabled or not device.user.is_active or device.user_id != notice.user_id or device.generation != job.generation or notice.read:
            PushDelivery.objects.filter(pk=job_id).update(status="skipped", lease_until=None)
            return
        if notice.kind in {"activity_reminder", "event_reminder"}:
            target = notice.activity or notice.event
            event = notice.activity.event if notice.activity else notice.event
            if not target or not event or event.status != "published":
                PushDelivery.objects.filter(pk=job_id).update(status="skipped", lease_until=None); return
            if notice.data.get("starts_at") != target.starts_at.isoformat() or target.ends_at <= timezone.now():
                PushDelivery.objects.filter(pk=job_id).update(status="skipped", lease_until=None); return
            registered = target.registrations.filter(user_id=notice.user_id).exists() if notice.activity_id else event.enrollments.filter(user_id=notice.user_id).exists()
            if not registered:
                PushDelivery.objects.filter(pk=job_id).update(status="skipped", lease_until=None); return
        validate_subscription({"endpoint": device.endpoint, "keys": device.keys})
        from pywebpush import webpush
        import requests
        class NoRedirectSession(requests.Session):
            def request(self, *args, **kwargs):
                kwargs["allow_redirects"] = False
                return super().request(*args, **kwargs)
        with NoRedirectSession() as session:
            response = webpush(subscription_info={"endpoint": device.endpoint, "keys": device.keys},
                # Detail is fetched by the service worker using the current account.
                # An in-flight message cannot expose a previous account after logout.
                data=json.dumps({"noticeId": notice.pk}), vapid_private_key=str(settings.WEB_PUSH_PRIVATE_KEY),
                vapid_claims={"sub": settings.WEB_PUSH_SUBJECT}, ttl=3600, timeout=6,
                requests_session=session, headers={"Urgency": "high" if notice.kind.endswith("reminder") else "normal"})
            if not 200 <= response.status_code < 300:
                raise RuntimeError("HTTP_" + str(response.status_code))
        PushDelivery.objects.filter(pk=job_id, generation=device.generation).update(status="sent", accepted_at=timezone.now(), lease_until=None, last_error="")
    except Exception as error:
        # Never log the exception: provider URLs/keys can be present in it.
        status = getattr(error, "status_code", None)
        response = getattr(error, "response", None)
        if status is None and response is not None: status = response.status_code
        if isinstance(error, RuntimeError) and str(error).startswith("HTTP_"):
            status = int(str(error).split("_")[1])
        job = PushDelivery.objects.select_related("subscription").filter(pk=job_id).first()
        if not job: return
        if status in {404, 410}:
            PushSubscription.objects.filter(pk=job.subscription_id, generation=job.generation).update(enabled=False)
            PushDelivery.objects.filter(pk=job_id).update(status="failed", lease_until=None, last_error="SUBSCRIPTION_GONE")
            return
        terminal = job.attempts >= 8 or isinstance(error, FlowError)
        PushDelivery.objects.filter(pk=job_id).update(status="failed" if terminal else "pending", lease_until=None,
            due_at=timezone.now()+timedelta(seconds=min(3600, 30*2**min(job.attempts, 7))),
            last_error=("HTTP_"+str(status)) if status else "DELIVERY_ERROR")
    finally:
        close_old_connections()


def deliver_due(limit=20):
    if not configured(): return 0
    now = timezone.now()
    with transaction.atomic():
        query = PushDelivery.objects.filter(status="pending", due_at__lte=now).filter(Q(lease_until__isnull=True)|Q(lease_until__lte=now)).order_by("due_at", "id")
        from django.db import connection
        query = query.select_for_update(skip_locked=True) if connection.features.has_select_for_update_skip_locked else query.select_for_update()
        jobs = list(query[:limit])
        for job in jobs:
            job.attempts += 1; job.lease_until = now + timedelta(seconds=180)
        PushDelivery.objects.bulk_update(jobs, ["attempts", "lease_until"])
    with ThreadPoolExecutor(max_workers=4) as executor:
        list(executor.map(deliver, [job.pk for job in jobs]))
    return len(jobs)
