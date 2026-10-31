"""Operational telemetry. Never label metrics or log requests with personal data."""
import contextvars
import hmac
import json
import logging
import os
import time
import traceback
import uuid
from datetime import datetime, timezone

from django.conf import settings
from django.http import HttpResponse
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Histogram, CollectorRegistry, generate_latest, multiprocess

SCHEDULE_WAIT = Histogram("tflow_schedule_lock_wait_seconds", "Time waiting for schedule consistency lock", buckets=(.001,.01,.05,.1,.5,1,2,5,10))
SCHEDULE_HOLD = Histogram("tflow_schedule_lock_hold_seconds", "Time spent holding schedule consistency lock", buckets=(.001,.01,.05,.1,.5,1,2,5,10))
request_id = contextvars.ContextVar("request_id", default=None)
REQUESTS = Counter("tflow_http_requests_total", "Completed HTTP requests", ["method", "route", "status"])
LATENCY = Histogram("tflow_http_duration_seconds", "HTTP latency", ["method", "route"], buckets=(.01, .05, .1, .25, .5, 1, 2, 5, 10))
ERRORS = Counter("tflow_errors_total", "Error log records", ["logger"])


def route_label(request):
    # The dispatcher resolves all API URLs to one route; split only known resources.
    parts = request.path.strip("/").split("/")
    if parts[0] == "api":
        resource = parts[1] if len(parts) > 1 else ""
        if resource in {"events", "activities", "communities", "profile", "auth", "notifications", "access-keys", "bootstrap", "health"}:
            return "/api/" + resource
        return "/api/other"
    if request.path in {"/", "/login/", "/register/", "/logout/", "/internal/metrics"}:
        return request.path
    return "/other"


class JsonFormatter(logging.Formatter):
    def format(self, record):
        data = {"timestamp": datetime.now(timezone.utc).isoformat(), "level": record.levelname,
                "logger": record.name, "request_id": request_id.get() or getattr(getattr(record, "request", None), "_tflow_request_id", None), "message": str(record.msg)[:2048]}
        # Stack locations are useful; exception messages/locals may contain SQL or credentials.
        if record.exc_info and record.exc_info[1] is not None:
            data["exception_type"] = type(record.exc_info[1]).__name__
            data["stack"] = [{"file": frame.filename, "line": frame.lineno, "function": frame.name}
                             for frame in traceback.extract_tb(record.exc_info[2])]
        for field in ("method", "route", "status", "duration_seconds"):
            if hasattr(record, field):
                data[field] = getattr(record, field)
        return json.dumps(data, ensure_ascii=False)


class ErrorMetricFilter(logging.Filter):
    def filter(self, record):
        if record.levelno >= logging.ERROR:
            ERRORS.labels("django" if record.name.startswith("django") else "flow").inc()
        return True


class RequestTelemetryMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        # Generate locally instead of trusting arbitrary inbound request IDs.
        identifier = uuid.uuid4().hex
        request._tflow_request_id = identifier
        context = request_id.set(identifier)
        start = time.monotonic()
        try:
            response = self.get_response(request)
            elapsed = time.monotonic() - start
            method = request.method if request.method in {"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"} else "OTHER"
            route = route_label(request)
            if route != "/internal/metrics":
                REQUESTS.labels(method, route, str(response.status_code)).inc()
                LATENCY.labels(method, route).observe(elapsed)
                logging.getLogger("flow.http").log(logging.ERROR if response.status_code >= 500 else logging.INFO,
                    "http_request", extra={"method": method, "route": route, "status": response.status_code, "duration_seconds": round(elapsed, 6)})
            response["X-Request-ID"] = identifier
            return response
        finally:
            request_id.reset(context)


def metrics_view(request):
    token = settings.MONITORING_TOKEN
    if not token or not hmac.compare_digest(request.headers.get("Authorization", "").encode(), ("Bearer " + token).encode()):
        return HttpResponse(status=404)
    if request.method != "GET":
        return HttpResponse(status=405)
    registry = None
    if os.environ.get("PROMETHEUS_MULTIPROC_DIR"):
        registry = CollectorRegistry()
        multiprocess.MultiProcessCollector(registry)
    response = HttpResponse(generate_latest(registry) if registry is not None else generate_latest(), content_type=CONTENT_TYPE_LATEST)
    response["Cache-Control"] = "no-store"
    return response
