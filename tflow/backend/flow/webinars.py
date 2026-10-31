import json
import logging
import time
import uuid
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener
import jwt
from django.conf import settings
from django.utils import timezone
from .contracts import FlowError
from .models import Activity, CheckIn, Event, Webinar


class NoMediaRedirects(HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        # A redirect must never forward an administrative bearer token elsewhere.
        return None


def urlopen(request, timeout):
    return build_opener(NoMediaRedirects()).open(request, timeout=timeout)

logger = logging.getLogger(__name__)


def configuration_error():
    if not all((settings.LIVEKIT_URL, settings.LIVEKIT_API_KEY, settings.LIVEKIT_API_SECRET)):
        return "На сервере не настроены адрес и ключи LiveKit. Администратору нужно подключить видеосервер."
    try:
        public = urlsplit(settings.LIVEKIT_URL)
        internal = urlsplit(settings.LIVEKIT_API_URL or settings.LIVEKIT_URL)
        if public.scheme not in {"ws", "wss", "http", "https"} or not public.hostname or public.username is not None or public.query or public.fragment:
            return "Публичный адрес LiveKit должен использовать WS, WSS, HTTP или HTTPS без ключей и параметров."
        if internal.scheme not in {"http", "https", "ws", "wss"} or not internal.hostname or internal.username is not None or internal.query or internal.fragment:
            return "Некорректный внутренний адрес LiveKit API."
        # Accessing .port also rejects malformed/out-of-range ports early.
        _ = public.port, internal.port
        if not settings.DEBUG and (public.scheme not in {"wss", "https"} or public.hostname in {"localhost", "127.0.0.1", "::1"}):
            return "Для опубликованного сайта нужен публичный WSS-адрес LiveKit. Адрес localhost доступен только самому серверу."
    except ValueError:
        return "Некорректный адрес видеосервера LiveKit."
    if not settings.DEBUG and len(settings.LIVEKIT_API_SECRET.encode("utf-8")) < 32:
        return "Секрет LiveKit должен содержать не менее 32 байт для опубликованного сайта."
    return ""


def configured():
    return not configuration_error()


def event_for_webinar(user, event_id, *, activity_id=None, access_key=None):
    activity = None
    try:
        if activity_id:
            activity = Activity.objects.select_related("event", "room").get(pk=activity_id)
            event = activity.event
        else:
            event = Event.objects.get(pk=event_id)
    except (Event.DoesNotExist, Activity.DoesNotExist) as error:
        raise FlowError("NOT_FOUND", "Мероприятие не найдено", 404) from error
    owner = event.owner_id == user.pk and user.role == "organizer"
    if access_key is not None:
        from .access_keys import resolve_key
        if activity is None:
            raise FlowError("INVALID_SCAN_KEY", "Ключ ведущего относится к конкретному онлайн-флоу", 403)
        resolve_key(user, access_key, purpose="webinar", event_id=event.pk, activity_id=activity.pk)
        owner = True
    if event.status != "published" and not owner:
        raise FlowError("NOT_FOUND", "Мероприятие не найдено", 404)
    if event.format not in {"Онлайн", "Гибрид"}:
        raise FlowError(
            "NOT_WEBINAR", "Видеокомната доступна для онлайн- и гибридных событий", 400
        )
    if activity and not activity.room.is_online:
        raise FlowError("NOT_WEBINAR", "У этой активности очная аудитория", 400)
    if not owner and user.role != "participant":
        raise FlowError(
            "FORBIDDEN", "Организатору доступна только студия своего события", 403
        )
    if not owner and not event.enrollments.filter(user=user).exists():
        raise FlowError(
            "NOT_REGISTERED", "Сначала зарегистрируйтесь на это событие", 403
        )
    if activity and activity.registration_required and not owner and not activity.registrations.filter(user=user).exists():
        raise FlowError("NOT_REGISTERED", "Сначала запишитесь на эту онлайн-активность", 403)
    return event, owner, activity


def status(user, event_id, *, activity_id=None, access_key=None):
    event, owner, activity = event_for_webinar(user, event_id, activity_id=activity_id, access_key=access_key)
    webinar = Webinar.objects.filter(event=event, activity=activity).first()
    return {
        "configured": configured(),
        "configuration_error": configuration_error(),
        "host": owner,
        "active": bool(webinar and webinar.active),
        "session": str(webinar.room) if webinar else None,
        "ended": min(event.ends_at, activity.ends_at if activity else event.ends_at) <= timezone.now(),
        "published": event.status == "published",
        "finished": bool(webinar and webinar.ended_at),
    }


def signed_token(identity, name, grants):
    if not configured():
        raise FlowError(
            "VIDEO_NOT_CONFIGURED", "Сервер трансляций не настроен безопасно", 503
        )
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
        if error.code == 404 and method == "GetParticipant":
            raise FlowError("ATTENDANCE_UNCONFIRMED", "Подключение к эфиру ещё не подтверждено. Повторите проверку", 409) from error
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


def stop_webinar(event, *, activity_id=None, all_rooms=False):
    webinars = Webinar.objects.filter(event=event, active=True)
    if not all_rooms:
        webinars = webinars.filter(activity_id=activity_id)
    for webinar in webinars:
        room_api("DeleteRoom", room_name(webinar))
        webinar.active = False
        webinar.ended_at = timezone.now()
        webinar.save(update_fields=["active", "ended_at"])


def disconnect_viewer(user, event_id, *, activity_id=None):
    webinars = (
        Webinar.objects.filter(event_id=event_id, active=True)
        .exclude(event__owner=user)
    )
    if activity_id is not None:
        webinars = webinars.filter(activity_id=activity_id)
    for webinar in webinars:
        try:
            room_api("RemoveParticipant", room_name(webinar), identity=str(user.pk))
        except FlowError:
            # Ticket cancellation still succeeds during a media-server outage.
            # The app disconnects on its next access check; new tokens are denied.
            pass


def operate(user, event_id, operation, session=None, *, activity_id=None, access_key=None):
    from .services import schedule_write

    with schedule_write():
        event, owner, activity = event_for_webinar(user, event_id, activity_id=activity_id, access_key=access_key)
        if operation not in {"start", "join", "end", "confirm"}:
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
            stop_webinar(event, activity_id=activity_id)
            return {"active": False}
        ends_at = min(event.ends_at, activity.ends_at if activity else event.ends_at)
        if event.status != "published" or ends_at <= timezone.now():
            raise FlowError(
                "WEBINAR_CLOSED",
                "Эфир доступен у опубликованного незавершённого события",
                409,
            )
        webinar, _ = Webinar.objects.get_or_create(event=event, activity=activity)
        if operation == "start" and not webinar.active:
            webinar.room = uuid.uuid4()
            online_room = event.rooms.filter(is_online=True).first()
            viewer_limit = (
                min(event.capacity, online_room.capacity)
                if online_room
                else event.capacity
            )
            if activity:
                viewer_limit = min(event.capacity, activity.capacity, activity.room.capacity)
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
        if operation == "confirm":
            if owner:
                raise FlowError("FORBIDDEN", "Посещение учитывается только для участника", 403)
            if session != str(webinar.room):
                raise FlowError("STALE_WEBINAR", "Эфир изменился. Подключитесь заново", 409)
            participant = room_api("GetParticipant", room_name(webinar), identity=str(user.pk))
            if participant.get("identity") != str(user.pk) or participant.get("state") not in {"JOINED", "ACTIVE", 1, 2}:
                raise FlowError("ATTENDANCE_UNCONFIRMED", "Сервер ещё не подтвердил подключение к эфиру", 409)
            entry, _ = CheckIn.objects.get_or_create(user=user, event=event, defaults={"source": "webinar", "checked_by": None})
            if activity is not None:
                from .models import ActivityAttendance
                ActivityAttendance.objects.get_or_create(user=user, activity=activity, defaults={"source": "webinar", "checked_by": None})
            return {"ok": True, "confirmed": True, "checked_in_at": round(entry.created_at.timestamp() * 1000)}
        grants = {
            "roomJoin": True,
            "room": room_name(webinar),
            "canPublish": owner,
            "canSubscribe": True,
            "canPublishData": True,
            "canUpdateOwnMetadata": False,
        }
        if access_key is not None:
            from .access_keys import resolve_key, record_use
            record_use(resolve_key(user, access_key, purpose="webinar", event_id=event.pk, activity_id=activity_id), user)
        return {
            "url": settings.LIVEKIT_URL.replace("https://", "wss://", 1).replace("http://", "ws://", 1),
            "token": signed_token(str(user.pk), user.name, grants),
            "host": owner,
            "session": str(webinar.room),
        }
