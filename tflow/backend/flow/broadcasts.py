"""Authenticated live video over ordinary same-origin HTTP requests."""
from datetime import timedelta
from functools import wraps
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import time
import uuid

from django.conf import settings
from django.db import IntegrityError, OperationalError
from django.http import FileResponse, JsonResponse
from django.utils import timezone
from django.utils.crypto import constant_time_compare
from django.views.decorators.cache import never_cache

from .contracts import FlowError
from .models import BroadcastMessage, HttpBroadcast, CheckIn, ActivityAttendance
from .services import schedule_write
from .webinars import event_for_webinar, start_schedule, ensure_started, start_time

MAX_CHUNK = 2 * 1024 * 1024
MAX_QUEUED_CHUNKS = 12
STALE_SECONDS = 30


def root():
    return Path(settings.HTTP_BROADCAST_ROOT)


def stream_dir(session):
    return root() / str(uuid.UUID(str(session)))


def media_dir(broadcast):
    directory = stream_dir(broadcast.session)
    return directory / f"media-{broadcast.media_epoch}" if broadcast.media_epoch else directory


def worker_ready():
    try:
        return settings.HTTP_BROADCAST_ENABLED and time.time() - (root() / "worker").stat().st_mtime < 10
    except OSError:
        return False


def live(broadcast):
    return bool(broadcast and broadcast.active and not broadcast.failure
                and broadcast.last_chunk_at and broadcast.last_chunk_at > timezone.now() - timedelta(seconds=STALE_SECONDS))


def scope(user, resource, item_id, access_key=None):
    if not user.is_authenticated:
        raise FlowError("UNAUTHORIZED", "Войдите, чтобы продолжить", 401)
    if resource not in {"events", "activities"}:
        raise FlowError("NOT_FOUND", "Комната не найдена", 404)
    return event_for_webinar(user, item_id if resource == "events" else None,
                             activity_id=item_id if resource == "activities" else None, access_key=access_key)


def status(user, event_id, *, activity_id=None, access_key=None):
    event, owner, activity = event_for_webinar(user, event_id, activity_id=activity_id, access_key=access_key)
    broadcast = HttpBroadcast.objects.filter(event=event, activity=activity).first()
    ready = worker_ready()
    active = bool(broadcast and broadcast.active and event.status == "published" and min(event.ends_at, activity.ends_at if activity else event.ends_at) > timezone.now())
    connected = live(broadcast) and timezone.now() >= start_time(event, activity)
    playlist = media_dir(broadcast) / "index.m3u8" if broadcast else None
    return {**start_schedule(event, activity), "transport": "https", "configured": ready,
            "configuration_error": "" if ready else "Трансляции временно недоступны. Попробуйте ещё раз чуть позже.",
            "host": owner, "active": active, "session": str(broadcast.session) if broadcast else None,
            "ready": bool(connected and playlist.is_file()), "reconnecting": bool(active and not connected),
            "can_resume": bool(active and owner and broadcast.publisher_user_id == user.pk),
            "playlist": f"/api/broadcasts/{broadcast.session}/media/{broadcast.media_epoch}/index.m3u8" if connected else None,
            "ended": min(event.ends_at, activity.ends_at if activity else event.ends_at) <= timezone.now(),
            "published": event.status == "published", "finished": bool(broadcast and not broadcast.active),
            "failure": broadcast.failure if broadcast else ""}


def api_view(function):
    @never_cache
    @wraps(function)
    def view(request, *args, **kwargs):
        try:
            if not settings.HTTP_BROADCAST_ENABLED:
                raise FlowError("NOT_FOUND", "Этот режим трансляции не включён", 404)
            if not request.user.is_authenticated:
                raise FlowError("UNAUTHORIZED", "Войдите, чтобы продолжить", 401)
            return function(request, *args, **kwargs)
        except FlowError as error:
            return JsonResponse({"error": error.message, "code": error.code}, status=error.status)
        except (IntegrityError, OperationalError):
            return JsonResponse({"error": "Данные изменились. Повторите запрос", "code": "CONFLICT"}, status=409)
    return view


def body(request):
    try:
        value = json.loads(request.body or b"{}")
        if not isinstance(value, dict):
            raise ValueError()
        return value
    except (ValueError, UnicodeError):
        raise FlowError("VALIDATION", "Некорректные данные", 400) from None


def access_key(request):
    return request.headers.get("X-TFlow-Access-Key") or None


def ensure_open(event, activity):
    if event.status != "published" or min(event.ends_at, activity.ends_at if activity else event.ends_at) <= timezone.now():
        raise FlowError("WEBINAR_CLOSED", "Мероприятие завершено или не опубликовано", 409)


@api_view
def control(request, resource, item_id):
    event, owner, activity = scope(request.user, resource, item_id, access_key(request))
    if request.method == "GET":
        return JsonResponse(status(request.user, event.pk, activity_id=activity.pk if activity else None, access_key=access_key(request)))
    if request.method != "POST":
        raise FlowError("METHOD_NOT_ALLOWED", "Действие недоступно", 405)
    data = body(request)
    if not owner:
        raise FlowError("FORBIDDEN", "Запускать и завершать эфир может только ведущий", 403)
    operation = data.get("operation")
    if not isinstance(operation,str) or operation not in {"start", "resume", "end"}:
        raise FlowError("VALIDATION", "Неизвестное действие", 400)
    with schedule_write():
        # Re-read schedule and host rights under the same lock as the start.
        event, owner, activity = scope(request.user, resource, item_id, access_key(request))
        if not owner:
            raise FlowError("FORBIDDEN", "Управлять эфиром может только ведущий", 403)
        broadcast, _ = HttpBroadcast.objects.get_or_create(event=event, activity=activity)
        if operation == "end":
            if data.get("session") != str(broadcast.session):
                raise FlowError("STALE_WEBINAR", "Эфир изменился. Обновите комнату", 409)
            was_active = broadcast.active
            broadcast.active, broadcast.publisher_hash = False, ""
            broadcast.save(update_fields=["active", "publisher_hash"])
            if was_active:
                from .notifications import broadcast_notice
                broadcast_notice(event, activity, ended=True)
            return JsonResponse({"active": False})
        if activity is None:
            raise FlowError("WEBINAR_ACTIVITY_REQUIRED", "Выберите конкретную онлайн-активность", 400)
        ensure_open(event, activity)
        ensure_started(event, activity)
        if not worker_ready():
            raise FlowError("VIDEO_NOT_CONFIGURED", "Сервис трансляции временно недоступен", 503)
        if operation == "resume":
            supplied = data.get("publisher", "")
            if not broadcast.active or broadcast.publisher_user_id != request.user.pk or not isinstance(supplied, str) or not constant_time_compare(hashlib.sha256(supplied.encode()).hexdigest(), broadcast.publisher_hash):
                raise FlowError("PUBLISHER_REQUIRED", "Вернитесь в исходную студию или завершите прежний эфир", 403)
        elif broadcast.active:
            raise FlowError("BROADCAST_BUSY", "Эфир уже ведётся. Завершите его перед новым запуском", 409)
        limit = timezone.now() - timedelta(seconds=STALE_SECONDS)
        if HttpBroadcast.objects.filter(active=True, last_chunk_at__gt=limit).exclude(pk=broadcast.pk).count() >= settings.HTTP_BROADCAST_MAX_STREAMS:
            raise FlowError("BROADCAST_CAPACITY", "Сейчас уже идут другие эфиры. Попробуйте позже", 503)
        mime = data.get("mime")
        if not isinstance(mime,str) or mime not in {"video/webm", "video/mp4"}:
            raise FlowError("VALIDATION", "Формат видео не поддерживается", 400)
        publisher = secrets.token_urlsafe(32)
        if operation == "resume":
            broadcast.media_epoch += 1
        else:
            broadcast.session, broadcast.media_epoch = uuid.uuid4(), 0
            broadcast.started_at = timezone.now()
        broadcast.mime = mime
        broadcast.publisher_user = request.user
        if access_key(request):
            from .access_keys import resolve_key
            broadcast.publisher_key = resolve_key(request.user, access_key(request), purpose="webinar", activity_id=activity.pk)
        else:
            broadcast.publisher_key = None
        broadcast.publisher_hash = hashlib.sha256(publisher.encode()).hexdigest()
        broadcast.active, broadcast.failure, broadcast.received_seq, broadcast.last_digest = True, "", -1, ""
        broadcast.last_chunk_at = timezone.now()
        broadcast.save()
        directory = media_dir(broadcast)
        directory.mkdir(mode=0o700, parents=True, exist_ok=False)
        from .notifications import broadcast_notice
        if operation == "start": broadcast_notice(event, activity)
        return JsonResponse({"session": str(broadcast.session), "publisher": publisher, "host": True})


def current(request, session):
    try:
        broadcast = HttpBroadcast.objects.select_related("event", "activity").get(session=session)
    except HttpBroadcast.DoesNotExist:
        raise FlowError("NOT_FOUND", "Эфир не найден", 404) from None
    activity = broadcast.activity
    event, owner, _ = event_for_webinar(request.user, broadcast.event_id,
                                      activity_id=activity.pk if activity else None, access_key=access_key(request))
    ensure_open(event, activity)
    ensure_started(event, activity)
    if not broadcast.active:
        raise FlowError("WEBINAR_NOT_STARTED", "Трансляция остановлена. Подключитесь заново", 409)
    return broadcast, owner


@api_view
def upload(request, session, sequence):
    if request.method != "POST":
        raise FlowError("METHOD_NOT_ALLOWED", "Действие недоступно", 405)
    with schedule_write():
        broadcast, owner = current(request, session)
        publisher = request.headers.get("X-TFlow-Publisher", "")
        if not owner or not constant_time_compare(hashlib.sha256(publisher.encode()).hexdigest(), broadcast.publisher_hash):
            raise FlowError("FORBIDDEN", "Публикация доступна только активной студии ведущего", 403)
        if not live(broadcast):
            raise FlowError("BROADCAST_RECONNECT_REQUIRED", "Восстановите передачу видео", 409)
        payload = request.body
        if not 0 < len(payload) <= MAX_CHUNK:
            raise FlowError("PAYLOAD_TOO_LARGE", "Фрагмент видео слишком большой", 413)
        digest = hashlib.sha256(payload).hexdigest()
        if sequence == broadcast.received_seq and digest == broadcast.last_digest:
            return JsonResponse({"next": sequence + 1})
        if sequence != broadcast.received_seq + 1:
            raise FlowError("CHUNK_ORDER", "Передача прервалась. Перезапустите эфир", 409)
        directory = media_dir(broadcast)
        if len(list(directory.glob("input-*.bin"))) >= MAX_QUEUED_CHUNKS:
            raise FlowError("BACKPRESSURE", "Видео обрабатывается медленнее отправки", 429)
        if sequence == 0 and not (payload.startswith(b"\x1aE\xdf\xa3") if broadcast.mime == "video/webm" else b"ftyp" in payload[:32]):
            raise FlowError("VALIDATION", "Некорректный заголовок видео", 400)
        temporary = directory / f"input-{sequence:09d}.tmp"
        temporary.write_bytes(payload)
        temporary.replace(directory / f"input-{sequence:09d}.bin")
        broadcast.received_seq, broadcast.last_digest, broadcast.last_chunk_at = sequence, digest, timezone.now()
        broadcast.save(update_fields=["received_seq", "last_digest", "last_chunk_at"])
    return JsonResponse({"next": sequence + 1})


@api_view
def media(request, session, filename, epoch=None):
    if request.method not in {"GET", "HEAD"}:
        raise FlowError("METHOD_NOT_ALLOWED", "Действие недоступно", 405)
    broadcast, owner = current(request, session)
    if filename != "index.m3u8" and not re.fullmatch(r"segment-\d{9}\.ts", filename):
        raise FlowError("NOT_FOUND", "Фрагмент не найден", 404)
    if epoch is not None and epoch != broadcast.media_epoch:
        raise FlowError("STALE_WEBINAR", "Видео переподключается", 409)
    path = media_dir(broadcast) / filename
    if not path.is_file():
        raise FlowError("NOT_FOUND", "Эфир подготавливается, подождите немного", 404)
    # Attendance requires delivery of real media, not merely status or playlist.
    if not owner and filename.endswith(".ts") and request.method == "GET":
        from .notifications import online_attendance
        online_attendance(request.user, broadcast.event, broadcast.activity)
    try:
        stream = path.open("rb")
    except FileNotFoundError:
        raise FlowError("NOT_FOUND", "Фрагмент уже сменился. Подключитесь к прямому эфиру", 404) from None
    response = FileResponse(stream, content_type="application/vnd.apple.mpegurl" if filename.endswith(".m3u8") else "video/mp2t")
    response["X-Content-Type-Options"] = "nosniff"
    return response


@api_view
def chat(request, session):
    broadcast, _ = current(request, session)
    if request.method == "POST":
        text = body(request).get("text")
        if not isinstance(text, str) or not text.strip() or len(text) > 1000:
            raise FlowError("VALIDATION", "Сообщение должно содержать от 1 до 1000 символов", 400)
        if "\x00" in text or any(0xD800 <= ord(char) <= 0xDFFF for char in text):
            raise FlowError("VALIDATION", "Недопустимый текст", 400)
        with schedule_write():
            if broadcast.messages.filter(author=request.user, created_at__gt=timezone.now() - timedelta(seconds=1)).exists():
                raise FlowError("CHAT_RATE", "Подождите секунду перед следующим сообщением", 429)
            BroadcastMessage.objects.create(broadcast=broadcast, session=session, author=request.user, text=text.strip())
            retained = list(broadcast.messages.order_by("-id").values_list("id", flat=True)[:100])
            broadcast.messages.exclude(id__in=retained).delete()
    elif request.method != "GET":
        raise FlowError("METHOD_NOT_ALLOWED", "Действие недоступно", 405)
    messages = list(broadcast.messages.filter(session=session).select_related("author").order_by("-id")[:100])
    return JsonResponse({"messages": [{"id": str(message.pk), "author": message.author.name,
                                       "text": message.text, "own": message.author_id == request.user.pk}
                                      for message in reversed(messages)]})
