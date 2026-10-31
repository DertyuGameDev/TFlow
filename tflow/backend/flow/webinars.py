import json
import time
import uuid
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener
import jwt
from django.conf import settings
from django.utils import timezone
from .contracts import FlowError
from .models import Activity, Event, Webinar


class NoMediaRedirects(HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        # A redirect must never forward an administrative bearer token elsewhere.
        return None


def urlopen(request, timeout):
    return build_opener(NoMediaRedirects()).open(request, timeout=timeout)


def configured():
    if not (
        settings.LIVEKIT_URL
        and settings.LIVEKIT_API_KEY
        and settings.LIVEKIT_API_SECRET
    ):
        return False
    try:
        url = urlsplit(settings.LIVEKIT_URL)
        valid = bool(url.hostname) and not (
            url.username or url.password or url.query or url.fragment
        )
    except ValueError:
        return False
    schemes = {"ws", "wss", "http", "https"} if settings.DEBUG else {"wss", "https"}
    return valid and url.scheme in schemes and (
        settings.DEBUG or len(settings.LIVEKIT_API_SECRET.encode("utf-8")) >= 32
    )


def event_for_webinar(user, event_id, *, activity_id=None):
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
    if activity and not owner and not activity.registrations.filter(user=user).exists():
        raise FlowError("NOT_REGISTERED", "Сначала запишитесь на эту онлайн-активность", 403)
    return event, owner, activity


def status(user, event_id, *, activity_id=None):
    event, owner, activity = event_for_webinar(user, event_id, activity_id=activity_id)
    webinar = Webinar.objects.filter(event=event, activity=activity).first()
    return {
        "configured": configured(),
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
        settings.LIVEKIT_URL.replace("wss://", "https://", 1)
        .replace("ws://", "http://", 1)
        .rstrip("/")
    )
    token = signed_token(
        "tflow-server", "ТФлоу", {"roomCreate": True, "roomAdmin": True, "room": room}
    )
    body = {"name" if method == "CreateRoom" else "room": room, **values}
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
        raise FlowError(
            "VIDEO_UNAVAILABLE",
            "Сервер трансляций временно недоступен. Повторите попытку",
            503,
        ) from error
    except (URLError, TimeoutError, ValueError, OSError) as error:
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


def operate(user, event_id, operation, *, activity_id=None):
    from .services import schedule_write

    with schedule_write():
        event, owner, activity = event_for_webinar(user, event_id, activity_id=activity_id)
        if operation not in {"start", "join", "end"}:
            raise FlowError("VALIDATION", "Неизвестное действие с эфиром", 400)
        if operation in {"start", "end"} and not owner:
            raise FlowError(
                "FORBIDDEN", "Управлять эфиром может только организатор события", 403
            )
        if not configured():
            raise FlowError(
                "VIDEO_NOT_CONFIGURED",
                "Организатор ещё не подключил сервер трансляций",
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
