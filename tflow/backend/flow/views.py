import json
import logging
from pathlib import Path
from django.conf import settings
from django.contrib.auth import login, logout
from django.core.exceptions import RequestDataTooBig
from django.db import IntegrityError, OperationalError
from django.http import FileResponse, HttpResponse, HttpResponseNotAllowed, JsonResponse
from django.middleware.csrf import get_token
from django.shortcuts import redirect, render
from django.utils.http import url_has_allowed_host_and_scheme
from django.views.decorators.cache import never_cache
from django.views.decorators.csrf import ensure_csrf_cookie
from .auth_forms import LoginForm, RegisterForm
from .contracts import (
    ActivityInput,
    EventInput,
    FlowError,
    MoveEventInput,
    ProfileInput,
    RoomInput,
    validate,
)
from .models import (
    Activity,
    Bookmark,
    Community,
    EventRegistration,
    Membership,
    Registration,
    User,
)
from .serializers import (
    activities_for,
    activity_json,
    bootstrap,
    event_json,
    identity,
    milliseconds,
    visible_events,
)
from . import services

logger = logging.getLogger("flow")


def invalid_json_constant(value):
    raise ValueError(f"Invalid JSON constant: {value}")


def safe_next(request):
    value = request.POST.get("next", request.GET.get("next", "/"))
    return (
        value
        if value.startswith("/")
        and not value.startswith("//")
        and url_has_allowed_host_and_scheme(
            value, allowed_hosts={request.get_host()}, require_https=request.is_secure()
        )
        else "/"
    )


@never_cache
def login_view(request):
    if request.user.is_authenticated:
        return redirect(safe_next(request))
    form = LoginForm(request, data=request.POST or None)
    if request.method == "POST" and form.is_valid():
        login(request, form.get_user())
        return redirect(safe_next(request))
    return render(
        request,
        "auth.html",
        {"form": form, "mode": "login", "next": safe_next(request)},
    )


@never_cache
def register_view(request):
    initial_role = (
        "organizer" if request.GET.get("role") == "organizer" else "participant"
    )
    form = RegisterForm(request.POST or None, initial={"role": initial_role})
    if request.method == "POST" and form.is_valid():
        try:
            user = form.save()
        except IntegrityError:
            form.add_error("email", "Этот адрес уже зарегистрирован")
        else:
            login(request, user)
            return redirect(safe_next(request))
    return render(
        request,
        "auth.html",
        {"form": form, "mode": "register", "next": safe_next(request)},
    )


def logout_view(request):
    if request.method != "POST":
        return HttpResponseNotAllowed(["POST"])
    logout(request)
    return redirect("/")


@ensure_csrf_cookie
def frontend(request):
    page = settings.PROJECT_DIR / "dist" / "index.html"
    if not page.is_file():
        return HttpResponse("Сначала выполните npm run build в папке tflow", status=503)
    return FileResponse(page.open("rb"), content_type="text/html; charset=utf-8")


def csrf_failure(request, reason=""):
    if request.path.startswith("/api/"):
        return JsonResponse(
            {
                "error": "Сессия формы устарела. Обновите страницу и повторите действие",
                "code": "CSRF_FAILED",
            },
            status=403,
        )
    return render(request, "csrf_error.html", status=403)


def require_user(request):
    if not request.user.is_authenticated:
        raise FlowError("UNAUTHORIZED", "Войдите, чтобы продолжить", 401)
    return request.user


@never_cache
@ensure_csrf_cookie
def api(request, path):
    try:
        return dispatch_api(request, path.strip("/"))
    except FlowError as error:
        data = {"error": error.message, "code": error.code}
        if hasattr(error, "fields"):
            data["fields"] = error.fields
        return JsonResponse(data, status=error.status)
    except IntegrityError:
        logger.exception("Database integrity check rejected a request")
        return JsonResponse(
            {
                "error": "Данные изменились. Обновите страницу и повторите действие",
                "code": "CONFLICT",
            },
            status=409,
        )
    except OperationalError:
        logger.exception("Database temporarily unavailable")
        return JsonResponse(
            {
                "error": "База занята. Повторите действие через несколько секунд",
                "code": "DATABASE_BUSY",
            },
            status=503,
        )


def dispatch_api(request, path):
    parts = path.split("/")
    if len(parts) > 3:
        raise FlowError("NOT_FOUND", "Страница не найдена", 404)
    resource, item_id, action = (parts + [None, None])[:3]
    method, user = request.method, request.user
    if path == "auth/me" and method == "GET":
        return JsonResponse({"user": identity(user), "csrfToken": get_token(request)})
    if path == "health" and method == "GET":
        from .models import ScheduleLock

        ScheduleLock.objects.get(pk=1)
        return JsonResponse({"ok": True, "backend": "django"})
    if path == "profile/qr" and method == "GET":
        from io import BytesIO
        import qrcode

        user = require_user(request)
        output = BytesIO()
        qrcode.make(
            request.build_absolute_uri(f"/#pass/{user.pass_token}"),
            box_size=9,
            border=4,
        ).save(output, format="PNG")
        return HttpResponse(
            output.getvalue(),
            content_type="image/png",
            headers={"Cache-Control": "private, no-store"},
        )
    if method == "GET":
        if path == "bootstrap":
            return JsonResponse(bootstrap(user))
        if resource == "events" and item_id:
            if action == "attendance":
                event = services.owned_event(item_id, require_user(request))
                rows = event.enrollments.select_related("user").order_by("-created_at")
                check_ins = {entry.user_id: entry for entry in event.check_ins.all()}
                return JsonResponse(
                    [
                        {
                            "id": row.user_id,
                            "name": row.user.name,
                            "email": row.user.email,
                            "city": row.user.city,
                            "created_at": milliseconds(row.created_at),
                            "checked_in_at": (
                                milliseconds(check_ins[row.user_id].created_at)
                                if row.user_id in check_ins
                                else None
                            ),
                        }
                        for row in rows
                    ],
                    safe=False,
                )
            if action == "attendee":
                _, person = services.attendee_by_qr(
                    require_user(request), item_id, request.GET.get("qr", "")
                )
                return JsonResponse(attendee_json(person, item_id))
            if action == "participants":
                services.owned_event(item_id, require_user(request))
                rows = (
                    Registration.objects.filter(activity__event_id=item_id)
                    .select_related("user", "activity")
                    .order_by("activity__starts_at", "user__name")
                )
                return JsonResponse(
                    [
                        {
                            "id": r.user_id,
                            "name": r.user.name,
                            "email": r.user.email,
                            "activity_id": r.activity_id,
                            "activity_title": r.activity.title,
                            "created_at": milliseconds(r.created_at),
                        }
                        for r in rows
                    ],
                    safe=False,
                )
            if not action:
                event = visible_events(user).filter(pk=item_id).first()
                if not event:
                    raise FlowError("NOT_FOUND", "Мероприятие не найдено", 404)
                return JsonResponse(
                    {
                        "event": event_json(event),
                        "rooms": list(
                            event.rooms.values("id", "event_id", "name", "capacity")
                        ),
                        "activities": [
                            activity_json(a)
                            for a in activities_for(user).filter(event=event)
                        ],
                    }
                )
        raise FlowError("NOT_FOUND", "Страница не найдена", 404)
    if method not in {"POST", "PATCH", "DELETE"}:
        return JsonResponse(
            {"error": "Метод не поддерживается", "code": "METHOD_NOT_ALLOWED"},
            status=405,
        )
    user = require_user(request)
    if method == "DELETE":
        body = {}
    else:
        try:
            body = json.loads(
                request.body or b"{}", parse_constant=invalid_json_constant
            )
        except RequestDataTooBig as error:
            raise FlowError(
                "PAYLOAD_TOO_LARGE", "Слишком большой запрос", 413
            ) from error
        except (ValueError, UnicodeDecodeError, RecursionError) as error:
            raise FlowError(
                "VALIDATION", "Не удалось прочитать данные формы", 400
            ) from error
        if not isinstance(body, dict):
            raise FlowError("VALIDATION", "Ожидается объект с полями формы", 400)
        if any(isinstance(value, (dict, list)) for value in body.values()):
            raise FlowError("VALIDATION", "Поля формы должны содержать простые значения", 400)
    if path == "profile" and method == "PATCH":
        values = validate(ProfileInput, body)
        for key, value in values.items():
            setattr(user, key, value)
        user.save(update_fields=list(values))
    elif path == "notifications" and method == "PATCH":
        user.notifications.update(read=True)
    elif (
        resource == "communities"
        and item_id
        and action == "join"
        and method in {"POST", "DELETE"}
    ):
        if not Community.objects.filter(pk=item_id).exists():
            raise FlowError("NOT_FOUND", "Сообщество не найдено", 404)
        if method == "POST":
            Membership.objects.get_or_create(user=user, community_id=item_id)
        else:
            Membership.objects.filter(user=user, community_id=item_id).delete()
    elif resource == "events":
        if not item_id and method == "POST":
            event = services.create_event(user, validate(EventInput, body))
            return JsonResponse({"id": event.pk}, status=201)
        if item_id and action == "bookmark" and method in {"POST", "DELETE"}:
            if not visible_events(user).filter(pk=item_id).exists():
                raise FlowError("NOT_FOUND", "Мероприятие не найдено", 404)
            if method == "POST":
                Bookmark.objects.get_or_create(user=user, event_id=item_id)
            else:
                Bookmark.objects.filter(user=user, event_id=item_id).delete()
        elif item_id and not action and method == "PATCH":
            services.update_event(user, item_id, validate(EventInput, body))
        elif item_id and action == "publish" and method == "POST":
            services.publish_event(user, item_id)
        elif item_id and action == "move" and method == "PATCH":
            services.move_event(user, item_id, validate(MoveEventInput, body))
        elif item_id and action == "registration" and method == "POST":
            services.enroll_event(user, item_id)
        elif item_id and action == "registration" and method == "DELETE":
            services.cancel_event(user, item_id)
        elif item_id and action == "check-in" and method == "POST":
            person, entry, repeated = services.check_in(
                user, item_id, body.get("qr", "")
            )
            return JsonResponse(
                {
                    "admitted": True,
                    "already_checked_in": repeated,
                    "checked_in_at": milliseconds(entry.created_at),
                    "attendee": attendee_json(person, item_id),
                }
            )
        elif item_id and action == "rooms" and method == "POST":
            room = services.save_room(user, validate(RoomInput, body), event_id=item_id)
            return JsonResponse({"id": room.pk}, status=201)
        elif item_id and action == "activities" and method == "POST":
            activity = services.save_activity(
                user, validate(ActivityInput, body), event_id=item_id
            )
            return JsonResponse({"id": activity.pk}, status=201)
        else:
            raise FlowError("NOT_FOUND", "Действие не найдено", 404)
    elif resource == "rooms" and item_id and not action and method == "PATCH":
        services.save_room(user, validate(RoomInput, body), room_id=item_id)
    elif resource == "activities" and item_id:
        if action == "registration" and method == "POST":
            services.register(user, item_id)
        elif action == "registration" and method == "DELETE":
            services.cancel(user, item_id)
        elif not action and method == "PATCH":
            services.save_activity(
                user, validate(ActivityInput, body), activity_id=item_id
            )
        else:
            raise FlowError("NOT_FOUND", "Действие не найдено", 404)
    else:
        raise FlowError("NOT_FOUND", "Действие не найдено", 404)
    return JsonResponse({"ok": True})


def attendee_json(person, event_id):
    return {
        "id": person.pk,
        "name": person.name,
        "email": person.email,
        "city": person.city,
        "about": person.about,
        "interests": person.interests,
        "activities": list(
            person.registrations.filter(activity__event_id=event_id).values_list(
                "activity__title", flat=True
            )
        ),
    }
