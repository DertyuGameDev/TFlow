import json
import time
import uuid
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
import jwt
from django.conf import settings
from django.utils import timezone
from .contracts import FlowError
from .models import Event, Webinar


def configured():
    return bool(
        settings.LIVEKIT_URL
        and settings.LIVEKIT_API_KEY
        and settings.LIVEKIT_API_SECRET
    )


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
                "Организатор ещё не подключил сервер трансляций",
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
            room_api(
                "CreateRoom",
                room_name(webinar),
                empty_timeout=300,
                max_participants=event.capacity + 1,
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
