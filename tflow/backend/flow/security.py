"""Request bounds and database-backed authentication throttling."""

from datetime import timedelta
from ipaddress import ip_address, ip_network
from math import ceil

from django.conf import settings
from django.core.files.uploadhandler import FileUploadHandler, StopUpload
from django.db import OperationalError, transaction
from django.http import JsonResponse
from django.shortcuts import render
from django.utils import timezone
from django.utils.crypto import salted_hmac

from .avatars import MAX_UPLOAD
from .models import AuthRateLimit

MAX_JSON_BODY = 256 * 1024
MAX_AUTH_BODY = 64 * 1024
MAX_AVATAR_BODY = 6 * 1024 * 1024


class AvatarUploadLimitHandler(FileUploadHandler):
    """Bound combined file data before temporary files can grow unbounded."""

    def __init__(self, request):
        super().__init__(request)
        self.received = 0

    def receive_data_chunk(self, raw_data, start):
        self.received += len(raw_data)
        if self.received > MAX_UPLOAD:
            self.request._tflow_upload_too_large = True
            raise StopUpload(connection_reset=True)
        return raw_data

    def file_complete(self, file_size):
        return None


class RequestLimitsMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        path = request.path_info.rstrip("/")
        avatar = path == "/api/profile/avatar" or (
            path.startswith("/api/communities/") and path.endswith("/avatar")
        )
        if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
            limit = None
            if avatar:
                limit = MAX_AVATAR_BODY
            elif path.startswith("/api/"):
                configured = settings.DATA_UPLOAD_MAX_MEMORY_SIZE
                limit = (
                    min(MAX_JSON_BODY, configured)
                    if configured is not None
                    else MAX_JSON_BODY
                )
            elif path in {"/login", "/register"}:
                limit = MAX_AUTH_BODY
            if limit is not None:
                try:
                    length = int(request.META.get("CONTENT_LENGTH") or 0)
                except (TypeError, ValueError):
                    length = -1
                if length < 0 or length > limit:
                    response = JsonResponse(
                        {
                            "error": "Слишком большой или некорректный запрос",
                            "code": "PAYLOAD_TOO_LARGE",
                        },
                        status=413,
                    )
                    response["Cache-Control"] = "no-store"
                    return response
        if avatar and request.method == "POST":
            # Install before CsrfViewMiddleware, which can parse multipart data.
            request.upload_handlers.insert(0, AvatarUploadLimitHandler(request))
        return self.get_response(request)


def client_address(request):
    """Discard spoofed forwarding headers unless the immediate peer is trusted."""
    if settings.IS_VERCEL:
        # Vercel overwrites this header at its edge; never trust it off-platform.
        forwarded = request.META.get("HTTP_X_VERCEL_FORWARDED_FOR", "")
        try:
            return str(ip_address(forwarded))
        except ValueError:
            pass
    try:
        peer = ip_address(request.META.get("REMOTE_ADDR", ""))
    except ValueError:
        return "unknown"
    try:
        trusted = [ip_network(value) for value in settings.AUTH_TRUSTED_PROXY_IPS]
    except ValueError:
        return str(peer)
    if not any(peer in network for network in trusted):
        return str(peer)
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
    if not forwarded or len(forwarded) > 2048:
        return str(peer)
    try:
        chain = [ip_address(value.strip()) for value in forwarded.split(",")] + [peer]
    except ValueError:
        return str(peer)
    while len(chain) > 1 and any(chain[-1] in network for network in trusted):
        chain.pop()
    return str(chain[-1])


def take_auth_attempt(request, action):
    address = client_address(request)
    budgets = [
        (
            f"{action}:ip:{address}",
            (
                settings.AUTH_LOGIN_IP_LIMIT
                if action == "login"
                else settings.AUTH_REGISTER_IP_LIMIT
            ),
        )
    ]
    if action == "login":
        identifier = request.POST.get("username", "").strip().lower()
        budgets.append(
            (
                f"login:account:{address}:{identifier}",
                settings.AUTH_LOGIN_ACCOUNT_IP_LIMIT,
            )
        )
    now = timezone.now()
    with transaction.atomic():
        AuthRateLimit.objects.filter(expires_at__lte=now).delete()
        rows = []
        for value, limit in budgets:
            key = salted_hmac(
                "tflow.auth-attempt", value, algorithm="sha256"
            ).hexdigest()
            budget, _ = AuthRateLimit.objects.select_for_update().get_or_create(
                key=key,
                defaults={
                    "expires_at": now
                    + timedelta(seconds=settings.AUTH_RATE_LIMIT_WINDOW)
                },
            )
            if budget.attempts >= limit:
                return max(1, ceil((budget.expires_at - now).total_seconds()))
            rows.append(budget)
        for budget in rows:
            budget.attempts += 1
            budget.save(update_fields=["attempts"])
    return 0


def auth_attempt_response(request, action):
    try:
        retry_after = take_auth_attempt(request, action)
    except OperationalError:
        # Never bypass the throttle when its shared store is unavailable.
        retry_after = 5
        unavailable = True
    else:
        if not retry_after:
            return None
        unavailable = False
    if action == "register" and request.POST.get("intent") == "credentials":
        message = (
            "Вход временно недоступен. Повторите попытку через несколько секунд."
            if unavailable
            else f"Слишком много попыток. Подождите примерно {ceil(retry_after / 60)} мин."
        )
        response = JsonResponse(
            {
                "valid": False,
                "error": message,
                "code": "AUTH_UNAVAILABLE" if unavailable else "AUTH_RATE_LIMITED",
            },
            status=503 if unavailable else 429,
        )
    else:
        response = render(
            request,
            "auth_limited.html",
            {"unavailable": unavailable, "minutes": max(1, ceil(retry_after / 60))},
            status=503 if unavailable else 429,
        )
    response["Retry-After"] = str(retry_after)
    response["Cache-Control"] = "no-store"
    return response
