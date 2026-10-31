"""Narrow, signed DNS-01 relay for vm1, whose network cannot reach DuckDNS."""
import hashlib
import hmac
import json
import re
import time
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from django.conf import settings
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST


@csrf_exempt
@require_POST
def dns_challenge(request):
    secret = settings.TFLOW_DNS_HOOK_SECRET
    token = settings.TFLOW_DUCKDNS_TOKEN
    if not secret or not token:
        return JsonResponse({"error": "DNS relay unavailable"}, status=503)
    if len(request.body) > 1024:
        return JsonResponse({"error": "Invalid request"}, status=400)
    expected = hmac.new(secret.encode(), request.body, hashlib.sha256).hexdigest()
    signature = request.headers.get("X-TFlow-Hook-Signature", "")
    if not re.fullmatch(r"[0-9a-f]{64}", signature) or not hmac.compare_digest(expected, signature):
        return JsonResponse({"error": "Forbidden"}, status=403)
    try:
        body = json.loads(request.body)
        if set(body) != {"txt", "clear", "timestamp"} or type(body["timestamp"]) is not int or abs(int(time.time()) - body["timestamp"]) > 60:
            raise ValueError()
        if type(body["clear"]) is not bool or not isinstance(body["txt"], str) or not re.fullmatch(r"[A-Za-z0-9_-]{43}", body["txt"]):
            raise ValueError()
    except (ValueError, TypeError, KeyError):
        return JsonResponse({"error": "Invalid request"}, status=400)
    # The caller cannot choose a domain, URL, IP, or record type. Only the
    # challenge TXT for our one technical hostname is delegated.
    values = {"domains": "tflow-video-162f2c", "token": token, "txt": body["txt"]}
    if body["clear"]:
        values["clear"] = "true"
    try:
        with urlopen(Request("https://www.duckdns.org/update?" + urlencode(values)), timeout=10) as response:
            if not response.read(1024).startswith(b"OK"):
                raise ValueError()
    except Exception:
        return JsonResponse({"error": "DNS provider unavailable"}, status=503)
    return JsonResponse({"ok": True})
