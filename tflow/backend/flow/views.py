import ipaddress
import json
import logging
from pathlib import Path
from django.conf import settings
from django.contrib.auth import login, logout
from django.db import IntegrityError, OperationalError
from django.http import FileResponse, HttpResponse, HttpResponseNotAllowed, JsonResponse
from django.middleware.csrf import get_token
from django.shortcuts import redirect, render
from django.utils.http import url_has_allowed_host_and_scheme
from django.views.decorators.cache import never_cache
from django.views.decorators.csrf import ensure_csrf_cookie
from .auth_forms import LoginForm, RegisterForm
from .contracts import ActivityInput, EventInput, FlowError, ProfileInput, RoomInput, validate
from .demo import initialize_demo
from .models import Activity, Bookmark, Community, Membership, Registration, User
from .serializers import activities_for, activity_json, bootstrap, event_json, identity, milliseconds, visible_events
from . import services

logger = logging.getLogger("flow")


def safe_next(request):
    value = request.POST.get("next", request.GET.get("next", "/"))
    return value if value.startswith("/") and not value.startswith("//") and url_has_allowed_host_and_scheme(value, allowed_hosts={request.get_host()}, require_https=request.is_secure()) else "/"


def local_demo_available(request):
    try:
        return settings.DEBUG and ipaddress.ip_address(request.META.get("REMOTE_ADDR", "")).is_loopback
    except ValueError:
        return False


@never_cache
def login_view(request):
    if request.user.is_authenticated:
        return redirect(safe_next(request))
    form = LoginForm(request, data=request.POST or None)
    if request.method == "POST" and form.is_valid():
        login(request, form.get_user())
        return redirect(safe_next(request))
    return render(request, "auth.html", {"form": form, "mode": "login", "next": safe_next(request), "allow_demo": local_demo_available(request)})


@never_cache
def register_view(request):
    form = RegisterForm(request.POST or None)
    if request.method == "POST" and form.is_valid():
        try:
            user = form.save()
        except IntegrityError:
            form.add_error("email", "Этот адрес уже зарегистрирован")
        else:
            login(request, user)
            return redirect(safe_next(request))
    return render(request, "auth.html", {"form": form, "mode": "register", "next": safe_next(request)})


def demo_login_view(request):
    if request.method != "POST":
        return HttpResponseNotAllowed(["POST"])
    if not local_demo_available(request):
        return HttpResponse(status=404)
    user, created = User.objects.get_or_create(pk="local_seedy", defaults={"email": "seedy@sites.test", "name": "Демо-организатор"})
    if created:
        user.set_unusable_password()
        user.save(update_fields=["password"])
    if user.has_usable_password():
        return HttpResponse("Для этого аккаунта используйте обычный вход", status=403)
    login(request, user, backend="django.contrib.auth.backends.ModelBackend")
    initialize_demo(user)
    return redirect(safe_next(request))


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
        return JsonResponse({"error": "Сессия формы устарела. Обновите страницу и повторите действие", "code": "CSRF_FAILED"}, status=403)
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
        return JsonResponse({"error": "Данные изменились. Обновите страницу и повторите действие", "code": "CONFLICT"}, status=409)
    except OperationalError:
        logger.exception("Database temporarily unavailable")
        return JsonResponse({"error": "База занята. Повторите действие через несколько секунд", "code": "DATABASE_BUSY"}, status=503)


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
    if method == "GET":
        if path == "bootstrap":
            return JsonResponse(bootstrap(user))
        if resource == "events" and item_id:
            if action == "participants":
                services.owned_event(item_id, require_user(request))
                rows = Registration.objects.filter(activity__event_id=item_id).select_related("user", "activity").order_by("activity__starts_at", "user__name")
                return JsonResponse([{"id": r.user_id, "name": r.user.name, "email": r.user.email,
                                      "activity_id": r.activity_id, "activity_title": r.activity.title,
                                      "created_at": milliseconds(r.created_at)} for r in rows], safe=False)
            if not action:
                event = visible_events(user).filter(pk=item_id).first()
                if not event:
                    raise FlowError("NOT_FOUND", "Мероприятие не найдено", 404)
                return JsonResponse({"event": event_json(event),
                                     "rooms": list(event.rooms.values("id", "event_id", "name", "capacity")),
                                     "activities": [activity_json(a) for a in activities_for(user).filter(event=event)]})
        raise FlowError("NOT_FOUND", "Страница не найдена", 404)
    if method not in {"POST", "PATCH", "DELETE"}:
        return JsonResponse({"error": "Метод не поддерживается", "code": "METHOD_NOT_ALLOWED"}, status=405)
    user = require_user(request)
    if method == "DELETE":
        body = {}
    else:
        try:
            body = json.loads(request.body or b"{}")
        except (ValueError, UnicodeDecodeError) as error:
            raise FlowError("VALIDATION", "Не удалось прочитать данные формы", 400) from error
        if not isinstance(body, dict):
            raise FlowError("VALIDATION", "Ожидается объект с полями формы", 400)
    if path == "demo" and method == "POST":
        initialize_demo(user)
    elif path == "profile" and method == "PATCH":
        values = validate(ProfileInput, body)
        for key, value in values.items():
            setattr(user, key, value)
        user.save(update_fields=list(values))
    elif path == "notifications" and method == "PATCH":
        user.notifications.update(read=True)
    elif resource == "communities" and item_id and action == "join" and method in {"POST", "DELETE"}:
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
        elif item_id and action == "rooms" and method == "POST":
            room = services.save_room(user, validate(RoomInput, body), event_id=item_id)
            return JsonResponse({"id": room.pk}, status=201)
        elif item_id and action == "activities" and method == "POST":
            activity = services.save_activity(user, validate(ActivityInput, body), event_id=item_id)
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
            services.save_activity(user, validate(ActivityInput, body), activity_id=item_id)
        else:
            raise FlowError("NOT_FOUND", "Действие не найдено", 404)
    else:
        raise FlowError("NOT_FOUND", "Действие не найдено", 404)
    return JsonResponse({"ok": True})
