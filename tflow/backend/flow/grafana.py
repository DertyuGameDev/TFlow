"""Read-only Grafana behind the existing Django session and viewer allowlist."""
import hashlib
import hmac
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from django.conf import settings
from django.http import HttpResponse, HttpResponseNotAllowed
from django.shortcuts import redirect
from django.views.decorators.csrf import csrf_exempt


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


@csrf_exempt
def grafana_proxy(request, path=''):
    if not request.user.is_authenticated:
        return redirect('/login/?next=' + quote(request.get_full_path(), safe=''))
    owner = settings.GRAFANA_VIEWER_SHA256
    allowed_owner = bool(owner) and hmac.compare_digest(hashlib.sha256(str(request.user.pk).encode()).hexdigest(), owner)
    if request.user.role != 'organizer' or (not allowed_owner and request.user.email.lower() not in settings.GRAFANA_VIEWERS):
        return HttpResponse('Мониторинг недоступен этому аккаунту', status=403)
    if request.path == '/grafana':
        return redirect('/grafana/')
    if request.method not in {'GET', 'HEAD'}:
        # Grafana reads Prometheus through a POST query, without Django's CSRF field.
        # Only those read-only queries are allowed, and only from the same origin.
        if request.method != 'POST' or path not in {'api/ds/query', 'api/frontend-metrics'}:
            return HttpResponseNotAllowed(['GET', 'HEAD'])
        origin = urlsplit(request.headers.get('Origin', ''))
        if origin.scheme != request.scheme or origin.netloc != request.get_host():
            return HttpResponse(status=403)
        if len(request.body) > 256 * 1024:
            return HttpResponse(status=413)
    suffix = '?' + request.META['QUERY_STRING'] if request.META.get('QUERY_STRING') else ''
    upstream = Request('http://127.0.0.1:13001/grafana/' + (path or '') + suffix,
                       method=request.method, data=request.body if request.method == 'POST' else None,
                       headers={'Host': request.get_host(), 'X-Forwarded-Proto': request.scheme,
                                'X-WEBAUTH-USER': 'tflow-viewer', 'Accept-Encoding': 'identity',
                                'Content-Type': request.headers.get('Content-Type', 'application/json')})
    try:
        try:
            response = build_opener(NoRedirect()).open(upstream, timeout=30)
        except HTTPError as error:
            response = error
        with response:
            body = response.read(32 * 1024 * 1024 + 1)
            if len(body) > 32 * 1024 * 1024:
                return HttpResponse(status=502)
            result = HttpResponse(body, status=response.code,
                                  content_type=response.headers.get('Content-Type', 'application/octet-stream'))
            location = response.headers.get('Location')
            if location:
                target = urlsplit(location)
                if target.netloc and target.netloc != request.get_host():
                    return HttpResponse(status=502)
                result['Location'] = location
            result['Cache-Control'] = 'private, no-store'
            return result
    except (URLError, TimeoutError, OSError):
        return HttpResponse('Мониторинг запускается. Обновите страницу через несколько секунд.', status=503)
