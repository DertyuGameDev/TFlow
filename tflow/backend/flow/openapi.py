"""OpenAPI for the existing Django API; Swagger assets are served locally."""

from pathlib import Path
import re

from django import forms
from django.conf import settings
from django.http import FileResponse, Http404, JsonResponse
from django.shortcuts import render
from django.views.decorators.cache import never_cache
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_safe

from .auth_forms import LoginForm, RegisterForm
from .contracts import (
    ActivityInput,
    CommunityInput,
    EventInput,
    MillisecondsField,
    MoveEventInput,
    ProfileInput,
    ProfileRequirementsField,
    RequirementsInput,
    RoomInput,
)
from .profile_data import PROFILE_LABELS, REQUIREMENT_KEYS


def ref(name):
    return {"$ref": f"#/components/schemas/{name}"}


def object_schema(properties, required=()):
    result = {"type": "object", "properties": properties}
    if required:
        result["required"] = list(required)
    return result


def choice_values(choices):
    values = []
    for value, label in choices:
        if isinstance(label, (list, tuple)):
            values.extend(choice_values(label))
        else:
            values.append(value)
    return values


def form_schema(form_type):
    properties, required = {}, []
    for name, field in form_type().fields.items():
        if isinstance(field, MillisecondsField):
            value = {
                "type": "integer",
                "format": "int64",
                "description": "Unix time в миллисекундах",
            }
        elif isinstance(field, ProfileRequirementsField):
            value = {
                "type": "array",
                "uniqueItems": True,
                "items": {"type": "string", "enum": list(REQUIREMENT_KEYS)},
            }
        elif isinstance(field, forms.MultipleChoiceField):
            value = {
                "type": "array",
                "items": {"type": "string", "enum": choice_values(field.choices)},
            }
        elif isinstance(field, forms.ChoiceField):
            value = {"type": "string", "enum": choice_values(field.choices)}
        elif isinstance(field, forms.BooleanField):
            value = {"type": "boolean"}
        elif isinstance(field, forms.IntegerField):
            value = {"type": "integer", "format": "int64"}
            if field.min_value is not None:
                value["minimum"] = field.min_value
            if field.max_value is not None:
                value["maximum"] = field.max_value
        else:
            value = {"type": "string"}
            if isinstance(field, forms.EmailField):
                value["format"] = "email"
            elif isinstance(field, forms.URLField):
                value["format"] = "uri"
            elif isinstance(field, forms.DateField):
                value["format"] = "date"
            if name.startswith("password"):
                value.update(format="password", writeOnly=True)
        if field.label:
            value["title"] = str(field.label)
        properties[name] = value
        if field.required:
            required.append(name)
    return object_schema(properties, required)


def build_schema():
    text = {"type": "string"}
    number = {"type": "integer", "format": "int64"}
    profile_fields = {key: text for key in PROFILE_LABELS}
    schemas = {
        form.__name__: form_schema(form)
        for form in (
            EventInput,
            ActivityInput,
            RoomInput,
            CommunityInput,
            MoveEventInput,
            ProfileInput,
            RequirementsInput,
            LoginForm,
            RegisterForm,
        )
    }
    schemas.update(
        {
            "Ok": object_schema({"ok": {"type": "boolean"}}, ["ok"]),
            "Created": object_schema({"id": text}, ["id"]),
            "Error": object_schema(
                {
                    "error": text,
                    "code": text,
                    "fields": {
                        "type": "object",
                        "additionalProperties": {"type": "array", "items": text},
                    },
                    "missing_fields": {"type": "array", "items": text},
                },
                ["error", "code"],
            ),
            "ParticipantData": object_schema(profile_fields),
            "Profile": object_schema(
                {
                    **profile_fields,
                    "id": text,
                    "first_name": text,
                    "last_name": text,
                    "avatar_url": {"type": "string", "nullable": True},
                    "role": {"type": "string", "enum": ["participant", "organizer"]},
                    "pass_token": text,
                }
            ),
            "Event": object_schema(
                {
                    **schemas["EventInput"]["properties"],
                    "id": text,
                    "owner_id": text,
                    "organizer": text,
                    "community_id": {"type": "string", "nullable": True},
                    "required_profile_fields": schemas["RequirementsInput"][
                        "properties"
                    ]["required_profile_fields"],
                    "status": {"type": "string", "enum": ["draft", "published"]},
                    **{
                        name: number
                        for name in (
                            "participant_count",
                            "checked_in_count",
                            "activity_count",
                            "saved",
                            "enrolled",
                            "checked_in",
                            "event_waitlisted",
                            "event_waitlist_position",
                            "event_waiting_count",
                            "updated_at",
                        )
                    },
                }
            ),
            "Room": object_schema(
                {
                    "id": text,
                    "event_id": text,
                    "name": text,
                    "capacity": number,
                    "is_online": {"type": "boolean"},
                }
            ),
            "Activity": object_schema(
                {
                    **schemas["ActivityInput"]["properties"],
                    "id": text,
                    "event_id": text,
                    "room_name": text,
                    "room_is_online": {"type": "boolean"},
                    **{
                        name: number
                        for name in (
                            "taken",
                            "registered",
                            "waiting_count",
                            "waitlisted",
                            "waitlist_position",
                            "updated_at",
                        )
                    },
                }
            ),
            "Community": object_schema(
                {
                    **schemas["CommunityInput"]["properties"],
                    "id": text,
                    "owner_id": {"type": "string", "nullable": True},
                    "color": text,
                    "member_count": number,
                    "event_count": number,
                    "joined": number,
                    "subscribed": {"type": "boolean"},
                    "avatar_url": {"type": "string", "nullable": True},
                }
            ),
            "Notice": object_schema(
                {
                    "id": text,
                    "event_id": {"type": "string", "nullable": True},
                    "kind": {
                        "type": "string",
                        "enum": ["info", "event_cancelled", "club_event", "event_waitlist"],
                    },
                    "message": text,
                    "created_at": number,
                    "read": number,
                }
            ),
            "Attendance": object_schema(
                {
                    "id": text,
                    "name": text,
                    "email": text,
                    "city": text,
                    "profile_data": ref("ParticipantData"),
                    "created_at": number,
                    "checked_in_at": {
                        "type": "integer",
                        "format": "int64",
                        "nullable": True,
                    },
                }
            ),
            "Subscription": object_schema(
                {"enabled": {"type": "boolean"}}, ["enabled"]
            ),
            "Scan": object_schema({"qr": text}, ["qr"]),
            "AvatarUpload": object_schema(
                {"avatar": {"type": "string", "format": "binary"}}, ["avatar"]
            ),
        }
    )
    # Room creation fields are input-only; stored activities reference the saved room.
    schemas["Activity"]["properties"].pop("new_room_name")
    schemas["Activity"]["properties"].pop("new_room_capacity")
    schemas["Activity"]["properties"].pop("online_room")
    array = lambda name: {"type": "array", "items": ref(name)}
    schemas["EventDetail"] = object_schema(
        {"event": ref("Event"), "rooms": array("Room"), "activities": array("Activity")}
    )
    schemas["Bootstrap"] = object_schema(
        {
            "events": array("Event"),
            "tickets": array("Event"),
            "schedule": array("Activity"),
            "waitlist": array("Activity"),
            "communities": array("Community"),
            "notifications": array("Notice"),
            "unread_notification_count": number,
            "profile": {"allOf": [ref("Profile")], "nullable": True},
        }
    )
    paths = {}

    def add(
        path,
        method,
        title,
        tag,
        *,
        body=None,
        result="Ok",
        public=False,
        description="",
        status="200",
        query=(),
        content_type="application/json",
        binary=None,
        root=False,
    ):
        response = {
            "description": "Успешный ответ",
            "content": {
                binary
                or "application/json": {
                    "schema": (
                        {"type": "string", "format": "binary"}
                        if binary
                        else ref(result) if isinstance(result, str) else result
                    )
                }
            },
        }
        operation = {
            "operationId": re.sub(r"[^a-zA-Z0-9]+", "_", method + "_" + path).strip(
                "_"
            ),
            "summary": title,
            "tags": [tag],
            "description": description,
            "security": [] if public else [{"sessionCookie": []}],
            "responses": {
                status: response,
                **{
                    code: {
                        "description": label,
                        "content": {"application/json": {"schema": ref("Error")}},
                    }
                    for code, label in {
                        "400": "Ошибка полей",
                        "401": "Нужно войти",
                        "403": "Недостаточно прав или неверный CSRF",
                        "404": "Объект не найден",
                        "409": "Конфликт расписания, мест или состояния",
                        "503": "Временно недоступно",
                    }.items()
                },
            },
        }
        parameters = [
            {"name": name, "in": "path", "required": True, "schema": text}
            for name in re.findall(r"\{([^}]+)\}", path)
        ]
        parameters.extend(
            {"name": name, "in": "query", "required": required, "schema": text}
            for name, required in query
        )
        if parameters:
            operation["parameters"] = parameters
        if body is not None:
            operation["requestBody"] = {
                "required": True,
                "content": {
                    content_type: {
                        "schema": ref(body) if isinstance(body, str) else body
                    }
                },
            }
        if root:
            operation["servers"] = [{"url": "/"}]
            operation["responses"][status] = {
                "description": "Перенаправление после успешного действия; при ошибке возвращается HTML формы"
            }
        paths.setdefault(path, {})[method] = operation

    add("/health", "get", "Проверка сервера", "Общее", public=True)
    add(
        "/auth/me",
        "get",
        "Текущий аккаунт и CSRF-токен",
        "Аккаунт",
        public=True,
        result={"type": "object"},
    )
    add(
        "/bootstrap",
        "get",
        "Данные приложения",
        "Общее",
        public=True,
        result="Bootstrap",
    )
    add(
        "/login/",
        "post",
        "Войти",
        "Аккаунт",
        body="LoginForm",
        public=True,
        content_type="application/x-www-form-urlencoded",
        status="302",
        root=True,
    )
    add(
        "/register/",
        "post",
        "Зарегистрироваться",
        "Аккаунт",
        body="RegisterForm",
        public=True,
        content_type="application/x-www-form-urlencoded",
        status="302",
        root=True,
        description="Роль выбирается навсегда. В локальном режиме демонстрации разрешены простые пароли.",
    )
    add("/logout/", "post", "Выйти", "Аккаунт", status="302", root=True)
    add("/profile", "patch", "Изменить свой профиль", "Аккаунт", body="ProfileInput")
    add(
        "/profile/qr",
        "get",
        "Личный QR участника",
        "Аккаунт",
        binary="image/png",
        description="Только аккаунт участника.",
    )
    for method in ("get", "post", "delete"):
        add(
            "/profile/avatar",
            method,
            {"get": "Фото профиля", "post": "Загрузить фото", "delete": "Удалить фото"}[
                method
            ],
            "Аккаунт",
            body="AvatarUpload" if method == "post" else None,
            content_type="multipart/form-data",
            binary="image/webp" if method == "get" else None,
        )
    add(
        "/events",
        "post",
        "Создать событие",
        "События",
        body="EventInput",
        result="Created",
        status="201",
        description="Только организатор. Создаётся черновик.",
    )
    add(
        "/events/{event_id}",
        "get",
        "Событие и программа",
        "События",
        public=True,
        result="EventDetail",
        description="Черновики доступны только владельцу.",
    )
    add(
        "/events/{event_id}",
        "patch",
        "Изменить событие",
        "События",
        body="EventInput",
        description="Только владелец события.",
    )
    add(
        "/events/{event_id}",
        "delete",
        "Отменить и удалить событие",
        "События",
        description="Только владелец. Участники получают уведомление.",
    )
    add(
        "/events/{event_id}/publish",
        "post",
        "Опубликовать событие",
        "События",
        description="Владелец. Подписчики клуба получают одно уведомление при первой публикации.",
    )
    add(
        "/events/{event_id}/move",
        "patch",
        "Перенести событие вместе с программой",
        "События",
        body="MoveEventInput",
    )
    add(
        "/events/{event_id}/requirements",
        "patch",
        "Требования к анкете",
        "События",
        body="RequirementsInput",
    )
    add(
        "/events/{event_id}/calendar",
        "get",
        "Скачать событие в календарь",
        "События",
        public=True,
        binary="text/calendar",
    )
    for method in ("post", "delete"):
        add(
            "/events/{event_id}/waitlist", method,
            "Встать в очередь мероприятия" if method == "post" else "Выйти из очереди мероприятия",
            "Записи", body="ProfileInput" if method == "post" else None,
            result=object_schema({"ok": {"type": "boolean"}, "waitlisted": {"type": "boolean"}, "registered": {"type": "boolean"}}) if method == "post" else "Ok",
            description="Только участник. Очередь FIFO. При свободном месте регистрация происходит сразу. Обязательные поля анкеты проверяются; при отмене чужой записи место выдаётся автоматически с уведомлением.",
        )
        add(
            "/events/{event_id}/bookmark",
            method,
            "Сохранить событие" if method == "post" else "Убрать из сохранённых",
            "События",
        )
        add(
            "/events/{event_id}/registration",
            method,
            "Записаться на событие" if method == "post" else "Отменить запись",
            "Записи",
            body="ProfileInput" if method == "post" else None,
            description="Только участник. Недостающие данные анкеты передаются в том же запросе.",
        )
        for action, label in (
            ("registration", "запись на активность"),
            ("waitlist", "лист ожидания"),
        ):
            add(
                f"/activities/{{activity_id}}/{action}",
                method,
                ("Добавить: " if method == "post" else "Отменить: ") + label,
                "Записи",
                body="ProfileInput" if method == "post" else None,
            )
    add(
        "/events/{event_id}/rooms",
        "post",
        "Создать аудиторию",
        "Программа",
        body="RoomInput",
        result="Created",
        status="201",
    )
    add(
        "/rooms/{room_id}", "patch", "Изменить аудиторию", "Программа", body="RoomInput"
    )
    add(
        "/events/{event_id}/activities",
        "post",
        "Создать пункт программы и аудиторию",
        "Программа",
        body="ActivityInput",
        result="Created",
        status="201",
        description="Владелец события. Для новой очной аудитории передайте new_room_name и new_room_capacity вместо room_id. Для единственного онлайн-потока передайте online_room=true. При ошибке откатываются все изменения.",
    )
    add(
        "/activities/{activity_id}",
        "patch",
        "Изменить пункт программы",
        "Программа",
        body="ActivityInput",
    )
    add(
        "/events/{event_id}/attendance",
        "get",
        "Участники и анкеты",
        "Участники",
        result=array("Attendance"),
        description="Только владелец события. Данные, переданные при записи.",
    )
    add(
        "/events/{event_id}/participants",
        "get",
        "Записи участников на активности",
        "Участники",
        result={"type": "array", "items": {"type": "object"}},
    )
    add(
        "/events/{event_id}/attendee",
        "get",
        "Найти участника по QR",
        "Участники",
        query=(("qr", True),),
        result={"type": "object"},
    )
    add(
        "/events/{event_id}/check-in",
        "post",
        "Отметить вход по QR",
        "Участники",
        body="Scan",
        result={"type": "object"},
        description="Одноразовый вход на событие. Повторное предъявление QR после успешного входа возвращает 409 ALREADY_CHECKED_IN. На другом событии требуется отдельная регистрация; личный QR сохраняется.",
    )
    add(
        "/schedule/calendar",
        "get",
        "Скачать личную программу",
        "Записи",
        binary="text/calendar",
    )
    add(
        "/events/{event_id}/webinar",
        "get",
        "Состояние вебинара",
        "Вебинары",
        result={"type": "object"},
    )
    add(
        "/events/{event_id}/webinar",
        "post",
        "Управление вебинаром и вход",
        "Вебинары",
        body=object_schema(
            {"operation": {"type": "string", "enum": ["start", "join", "end"]}},
            ["operation"],
        ),
        result={"type": "object"},
        description="Организатор запускает (start) и завершает (end) свой эфир; зарегистрированный участник подключается через join.",
    )
    for method in ("get", "post"):
        add(
            "/activities/{activity_id}/webinar", method,
            "Состояние вебинара флоу" if method == "get" else "Управление отдельным вебинаром флоу",
            "Вебинары", result={"type": "object"},
            body=object_schema({"operation": {"type": "string", "enum": ["start", "join", "end"]}}, ["operation"]) if method == "post" else None,
            description="Изолированный эфир онлайн-активности. Владелец события запускает и завершает только этот эфир. Для просмотра нужна регистрация на событие и эту активность. Параллельные флоу имеют разные комнаты, видео, звук и чат.",
        )
    add(
        "/communities",
        "post",
        "Создать клуб",
        "Клубы",
        body="CommunityInput",
        result="Created",
        status="201",
    )
    add(
        "/communities/{community_id}",
        "patch",
        "Изменить свой клуб",
        "Клубы",
        body="CommunityInput",
        result="Created",
    )
    for method in ("post", "delete"):
        add(
            "/communities/{community_id}/join",
            method,
            "Вступить в клуб" if method == "post" else "Выйти из клуба",
            "Клубы",
            description="Вступление включает подписку на новые события. Выход отключает её.",
        )
    add(
        "/communities/{community_id}/subscription",
        "patch",
        "Настроить подписку на события клуба",
        "Клубы",
        body="Subscription",
        description="Только участник этого клуба. enabled включает или выключает уведомления.",
    )
    for method in ("get", "post", "delete"):
        add(
            "/communities/{community_id}/avatar",
            method,
            {
                "get": "Фото клуба",
                "post": "Загрузить фото клуба",
                "delete": "Удалить фото клуба",
            }[method],
            "Клубы",
            body="AvatarUpload" if method == "post" else None,
            public=method == "get",
            content_type="multipart/form-data",
            binary="image/webp" if method == "get" else None,
        )
    add(
        "/notifications",
        "get",
        "Уведомления",
        "Уведомления",
        query=(("before", False), ("unread", False)),
        result=object_schema(
            {
                "items": array("Notice"),
                "next_cursor": {"type": "string", "nullable": True},
            }
        ),
    )
    add("/notifications", "patch", "Прочитать все уведомления", "Уведомления")
    add(
        "/notifications/{notification_id}",
        "patch",
        "Прочитать уведомление",
        "Уведомления",
    )
    return {
        "openapi": "3.0.3",
        "info": {
            "title": "ТФлоу API",
            "version": "1.0.0",
            "description": "Вход через обычную регистрацию/авторизацию сайта. Swagger использует текущую сессию браузера и CSRF-защиту. Роль участника или организатора постоянна; права проверяются сервером для каждого действия.",
        },
        "servers": [{"url": "/api"}],
        "paths": paths,
        "components": {
            "schemas": schemas,
            "securitySchemes": {
                "sessionCookie": {
                    "type": "apiKey",
                    "in": "cookie",
                    "name": settings.SESSION_COOKIE_NAME,
                    "description": "Войдите на сайте в этом браузере; cookie передаётся автоматически. Вручную вводить её не требуется.",
                }
            },
        },
    }


@require_safe
def schema_view(request):
    return JsonResponse(build_schema())


@require_safe
@never_cache
@ensure_csrf_cookie
def docs_view(request):
    return render(request, "swagger.html")


@require_safe
def swagger_asset(request, filename):
    if filename not in {"swagger-ui-bundle.js", "swagger-ui.css"}:
        raise Http404
    import drf_spectacular_sidecar

    path = (
        Path(drf_spectacular_sidecar.__file__).parent
        / "static"
        / "drf_spectacular_sidecar"
        / "swagger-ui-dist"
        / filename
    )
    return FileResponse(
        path.open("rb"),
        content_type=(
            "text/css" if filename.endswith(".css") else "application/javascript"
        ),
        headers={
            "Cache-Control": "public, max-age=3600",
            "X-Content-Type-Options": "nosniff",
        },
    )
