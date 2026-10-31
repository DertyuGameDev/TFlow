import json
import logging
import time
import uuid
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from urllib.parse import urlsplit
import jwt
from django.conf import settings
from django.utils import timezone
from .contracts import FlowError
from .models import Event, Webinar

logger = logging.getLogger(__name__)


def configuration_error():
    if not all((settings.LIVEKIT_URL, settings.LIVEKIT_API_KEY, settings.LIVEKIT_API_SECRET)):
        return "На сервере не настроены адрес и ключи LiveKit. Администратору нужно подключить видеосервер."
    try:
        public = urlsplit(settings.LIVEKIT_URL)
        internal = urlsplit(settings.LIVEKIT_API_URL or settings.LIVEKIT_URL)
        if public.scheme not in {"ws", "wss"} or not public.hostname or public.username is not None or public.query or public.fragment:
            return "Публичный адрес LiveKit должен быть WebSocket-адресом без ключей и параметров."
        if internal.scheme not in {"http", "https", "ws", "wss"} or not internal.hostname or internal.username is not None or internal.query or internal.fragment:
            return "Некорректный внутренний адрес LiveKit API."
        # Accessing .port also rejects malformed/out-of-range ports early.
        _ = public.port, internal.port
        if not settings.DEBUG and (public.scheme != "wss" or public.hostname in {"localhost", "127.0.0.1", "::1"}):
            return "Для опубликованного сайта нужен публичный WSS-адрес LiveKit. Адрес localhost доступен только самому серверу."
    except ValueError:
        return "Некорректный адрес видеосервера LiveKit."
    return ""


def configured():
    return not configuration_error()


def event_for_webinar(user, event_id):
    try:
        event = Event.objects.select_related("webinar").get(pk=event_id)
    except Event.DoesNotExist as error:
        raise FlowError("NOT_FOUND", "Мероприятие не найдено", 404) from error
    owner = event.owner_id == user.pk and user.role == "organizer"
    if event.status != "published" and not owner:
        raise FlowError("NOT_FOUND", "Мероприятие не найдено", 404)
    if event.format not in {"Онлайн", "Гибрид"}:
        raise FlowError(
            "NOT_WEBINAR", "Видеокомната доступна для онлайн- и гибридных событий", 400
        )
    if not owner and user.role != "participant":
        raise FlowError("FORBIDDEN", "Организатору доступна только студия своего события", 403)
    if not owner and not event.enrollments.filter(user=user).exists():
        raise FlowError(
            "NOT_REGISTERED", "Сначала зарегистрируйтесь на это событие", 403
        )
    return event, owner


def status(user, event_id):
    event, owner = event_for_webinar(user, event_id)
    webinar = getattr(event, "webinar", None)
    return {
        "configured": configured(),
        "configuration_error": configuration_error(),
        "host": owner,
        "active": bool(webinar and webinar.active),
        "session": str(webinar.room) if webinar else None,
        "ended": event.ends_at <= timezone.now(),
        "published": event.status == "published",
        "finished": bool(webinar and webinar.ended_at),
    }


def signed_token(identity, name, grants):
    now = int(time.time())
    return jwt.encode(
        {
            "iss": settings.LIVEKIT_API_KEY,
            "sub": identity,
            "name": name,
            "nbf": now - 5,
            "exp": now + 300,
            "video": grants,
        },
        settings.LIVEKIT_API_SECRET,
        algorithm="HS256",
    )


def room_name(webinar):
    return f"tflow-{webinar.room}"


def room_api(method, room, **values):
    url = (
        (settings.LIVEKIT_API_URL or settings.LIVEKIT_URL).replace("wss://", "https://", 1)
        .replace("ws://", "http://", 1)
        .rstrip("/")
    )
    grants = {"roomList": True} if method == "ListRooms" else {"roomCreate": True, "roomAdmin": True, "room": room}
    token = signed_token("tflow-server", "ТФлоу", grants)
    body = {**values} if method == "ListRooms" else {"name" if method == "CreateRoom" else "room": room, **values}
    request = Request(
        f"{url}/twirp/livekit.RoomService/{method}",
        data=json.dumps(body).encode(),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=5) as response:
            return json.load(response)
    except HTTPError as error:
        if error.code == 404 and method in {"DeleteRoom", "RemoveParticipant"}:
            return {}
        logger.warning("LiveKit %s returned HTTP %s", method, error.code)
        raise FlowError(
            "VIDEO_UNAVAILABLE",
            "Ключи приложения не приняты видеосервером. Администратору нужно проверить настройку LiveKit."
            if error.code in {401, 403}
            else "Сервер трансляций временно недоступен. Повторите попытку",
            503,
        ) from error
    except (URLError, TimeoutError, ValueError, OSError) as error:
        logger.warning("LiveKit %s failed: %s", method, type(error).__name__)
        raise FlowError(
            "VIDEO_UNAVAILABLE",
            "Не удалось подключиться к серверу трансляций. Повторите попытку",
            503,
        ) from error


def stop_webinar(event):
    webinar = Webinar.objects.filter(event=event, active=True).first()
    if webinar:
        room_api("DeleteRoom", room_name(webinar))
        webinar.active = False
        webinar.ended_at = timezone.now()
        webinar.save(update_fields=["active", "ended_at"])


def disconnect_viewer(user, event_id):
    webinar = (
        Webinar.objects.filter(event_id=event_id, active=True)
        .exclude(event__owner=user)
        .first()
    )
    if webinar:
        try:
            room_api("RemoveParticipant", room_name(webinar), identity=str(user.pk))
        except FlowError:
            # Ticket cancellation still succeeds during a media-server outage.
            # The app disconnects on its next access check; new tokens are denied.
            pass


def operate(user, event_id, operation):
    from .services import schedule_write

    with schedule_write():
        event, owner = event_for_webinar(user, event_id)
        if operation not in {"start", "join", "end"}:
            raise FlowError("VALIDATION", "Неизвестное действие с эфиром", 400)
        if operation in {"start", "end"} and not owner:
            raise FlowError(
                "FORBIDDEN", "Управлять эфиром может только организатор события", 403
            )
        if not configured():
            raise FlowError(
                "VIDEO_NOT_CONFIGURED",
                configuration_error(),
                503,
            )
        if operation == "end":
            stop_webinar(event)
            return {"active": False}
        if event.status != "published" or event.ends_at <= timezone.now():
            raise FlowError(
                "WEBINAR_CLOSED",
                "Эфир доступен у опубликованного незавершённого события",
                409,
            )
        webinar, _ = Webinar.objects.get_or_create(event=event)
        if operation == "start" and not webinar.active:
            webinar.room = uuid.uuid4()
            online_room = event.rooms.filter(is_online=True).first()
            viewer_limit = (
                min(event.capacity, online_room.capacity)
                if online_room
                else event.capacity
            )
            room_api(
                "CreateRoom",
                room_name(webinar),
                empty_timeout=300,
                max_participants=viewer_limit + 1,
            )
            webinar.active, webinar.started_at, webinar.ended_at = (
                True,
                timezone.now(),
                None,
            )
            webinar.save()
        if not webinar.active:
            raise FlowError("WEBINAR_NOT_STARTED", "Организатор ещё не начал эфир", 409)
        grants = {
            "roomJoin": True,
            "room": room_name(webinar),
            "canPublish": owner,
            "canSubscribe": True,
            "canPublishData": True,
            "canUpdateOwnMetadata": False,
        }
        return {
            "url": settings.LIVEKIT_URL,
            "token": signed_token(str(user.pk), user.name, grants),
            "host": owner,
            "session": str(webinar.room),
        }
