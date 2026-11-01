"""Reserved identities for the explicitly installed local jury dataset."""

from urllib.parse import urlsplit

from django.conf import settings
from django.db import connection

ALIASES = {
    **{str(i): f"{i}@jury.example.test" for i in range(1, 11)},
    "test": "test@jury.example.test",
}


def local_jury_login(request):
    if (
        not settings.DEBUG
        or settings.IS_VERCEL
        or connection.vendor != "sqlite"
        or request is None
    ):
        return False
    if urlsplit("http://" + request.get_host()).hostname not in {
        "localhost",
        "127.0.0.1",
        "::1",
    }:
        return False
    from .models import User

    return User.objects.filter(
        pk="jury-user-01", email=ALIASES["1"], role="participant", is_active=True
    ).exists()
