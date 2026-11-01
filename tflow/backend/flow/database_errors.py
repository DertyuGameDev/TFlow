"""Keep retryable database locks distinct from missing schema and outages."""

from django.conf import settings
from django.http import JsonResponse


def database_error_response(error):
    cause = error.__cause__ or error
    state = getattr(cause, "sqlstate", None)
    sqlite_code = getattr(cause, "sqlite_errorcode", 0) or 0
    message = str(cause).lower()
    missing_schema = state in {"42P01", "42703"} or any(
        value in message for value in ("no such table:", "no such column:", "has no column named")
    )
    locked = (sqlite_code & 255) in {5, 6} or state in {"55P03", "40P01", "40001"} or any(
        value in message for value in ("database is locked", "database table is locked", "database schema is locked")
    )
    if missing_schema:
        code = "DATABASE_NOT_READY"
        text = (
            "Локальная база не обновлена. Выполните npm run db:migrate."
            if settings.DEBUG
            else "Сервис временно недоступен. Попробуйте позднее."
        )
    elif locked:
        code = "DATABASE_BUSY"
        text = "База занята. Повторите действие через несколько секунд"
    else:
        code = "DATABASE_UNAVAILABLE"
        text = "База данных временно недоступна. Попробуйте позднее."
    response = JsonResponse({"error": text, "code": code}, status=503)
    if locked and not missing_schema:
        response["Retry-After"] = "3"
    return response
