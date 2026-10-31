import os
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

BASE_DIR = Path(__file__).resolve().parent.parent
PROJECT_DIR = BASE_DIR.parent
DATA_DIR = BASE_DIR / "data"
IS_VERCEL = os.environ.get("VERCEL") == "1"
DEBUG = os.environ.get("DJANGO_DEBUG", "0" if IS_VERCEL else "1") == "1"
DEMO_MODE = DEBUG and not IS_VERCEL and os.environ.get("TFLOW_DEMO_MODE", "0") == "1"
if not IS_VERCEL:
    DATA_DIR.mkdir(exist_ok=True)
SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "")
if not SECRET_KEY:
    if not DEBUG:
        raise RuntimeError("Set DJANGO_SECRET_KEY when DJANGO_DEBUG=0")
    # Checkout-local stable development key, never a shared production credential.
    secret_path = DATA_DIR / ".development-secret"
    if not secret_path.exists():
        from django.core.management.utils import get_random_secret_key

        try:
            with secret_path.open("x") as stream:
                stream.write(get_random_secret_key())
            secret_path.chmod(0o600)
        except FileExistsError:
            pass
    SECRET_KEY = secret_path.read_text().strip()

ALLOWED_HOSTS = os.environ.get(
    "DJANGO_ALLOWED_HOSTS", "127.0.0.1,localhost,[::1]"
).split(",")
CSRF_TRUSTED_ORIGINS = [
    v for v in os.environ.get("DJANGO_CSRF_TRUSTED_ORIGINS", "").split(",") if v
]
if IS_VERCEL:
    for key in ("VERCEL_URL", "VERCEL_PROJECT_PRODUCTION_URL", "VERCEL_BRANCH_URL"):
        host = os.environ.get(key, "")
        if host and "/" not in host:
            ALLOWED_HOSTS.append(host)
            CSRF_TRUSTED_ORIGINS.append(f"https://{host}")
INSTALLED_APPS = [
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "flow",
]
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]
ROOT_URLCONF = "config.urls"
TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ]
        },
    }
]
WSGI_APPLICATION = (
    "backend.config.wsgi.application" if IS_VERCEL else "config.wsgi.application"
)
if not IS_VERCEL:
    ASGI_APPLICATION = "config.asgi.application"
AUTH_USER_MODEL = "flow.User"
AUTH_PASSWORD_VALIDATORS = [
    {
        "NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"
    },
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]
if DEMO_MODE:
    AUTH_PASSWORD_VALIDATORS = []
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": os.environ.get("TFLOW_DATABASE_PATH", str(DATA_DIR / "tflow.sqlite3")),
        "OPTIONS": {"timeout": 30, "transaction_mode": "IMMEDIATE"},
        "TEST": {"NAME": str(DATA_DIR / "test.sqlite3")},
    }
}
if IS_VERCEL and not os.environ.get("DATABASE_URL"):
    raise RuntimeError("Vercel requires a persistent PostgreSQL DATABASE_URL")
if os.environ.get("DATABASE_URL"):
    url = urlparse(os.environ["DATABASE_URL"])
    if url.scheme not in {"postgres", "postgresql"}:
        raise RuntimeError("DATABASE_URL must use PostgreSQL")
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": unquote(url.path.lstrip("/")),
            "USER": unquote(url.username or ""),
            "PASSWORD": unquote(url.password or ""),
            "HOST": url.hostname,
            "PORT": url.port or 5432,
            "CONN_MAX_AGE": 0 if IS_VERCEL else 60,
            "OPTIONS": {
                key: values[-1]
                for key, values in parse_qs(url.query).items()
                if key in {"sslmode", "channel_binding", "connect_timeout"}
            },
            "DISABLE_SERVER_SIDE_CURSORS": IS_VERCEL,
        }
    }

LANGUAGE_CODE = "ru-ru"
TIME_ZONE = "Europe/Moscow"
USE_I18N = True
USE_TZ = True
LIVEKIT_URL = os.environ.get("LIVEKIT_URL", "ws://127.0.0.1:7880" if DEBUG else "")
LIVEKIT_API_KEY = os.environ.get("LIVEKIT_API_KEY", "devkey" if DEBUG else "")
LIVEKIT_API_SECRET = os.environ.get("LIVEKIT_API_SECRET", "secret" if DEBUG else "")
EMAIL_BACKEND = "django.core.mail.backends.smtp.EmailBackend"
EMAIL_HOST = os.environ.get("EMAIL_HOST", "smtp.yandex.ru")
EMAIL_PORT = int(os.environ.get("EMAIL_PORT", "465"))
EMAIL_HOST_USER = os.environ.get("EMAIL_HOST_USER", "")
EMAIL_HOST_PASSWORD = os.environ.get("EMAIL_HOST_PASSWORD", "")
EMAIL_USE_SSL = os.environ.get("EMAIL_USE_SSL", "1") == "1"
EMAIL_USE_TLS = os.environ.get("EMAIL_USE_TLS", "0") == "1"
EMAIL_TIMEOUT = 10
DEFAULT_FROM_EMAIL = os.environ.get("DEFAULT_FROM_EMAIL", EMAIL_HOST_USER)
NOTIFICATION_EMAIL_ENABLED = (
    os.environ.get(
        "NOTIFICATION_EMAIL_ENABLED",
        "1" if EMAIL_HOST_USER and EMAIL_HOST_PASSWORD else "0",
    )
    == "1"
)
PUBLIC_APP_URL = os.environ.get(
    "TFLOW_PUBLIC_URL",
    (
        f"https://{os.environ['VERCEL_PROJECT_PRODUCTION_URL']}"
        if os.environ.get("VERCEL_PROJECT_PRODUCTION_URL")
        else "http://localhost:5173" if DEBUG else ""
    ),
).rstrip("/")
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
APPEND_SLASH = False
LOGIN_URL = "/login/"
LOGIN_REDIRECT_URL = "/"
LOGOUT_REDIRECT_URL = "/"
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_SECURE = not DEBUG
CSRF_FAILURE_VIEW = "flow.views.csrf_failure"
X_FRAME_OPTIONS = "DENY"
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_SSL_REDIRECT = not DEBUG and os.environ.get("DJANGO_HTTPS_REDIRECT", "1") == "1"
SECURE_HSTS_SECONDS = 31536000 if not DEBUG else 0
SECURE_HSTS_INCLUDE_SUBDOMAINS = not DEBUG
SECURE_HSTS_PRELOAD = not DEBUG
# Enable only behind a trusted reverse proxy which overwrites X-Forwarded-Proto.
if IS_VERCEL or os.environ.get("DJANGO_TRUST_PROXY", "0") == "1":
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STATICFILES_DIRS = [PROJECT_DIR / "public"]
if (PROJECT_DIR / "dist").is_dir():
    STATICFILES_DIRS.append(("app", PROJECT_DIR / "dist"))
WHITENOISE_ROOT = PROJECT_DIR / "dist"
WHITENOISE_USE_FINDERS = DEBUG
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedStaticFilesStorage"},
}
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {"console": {"class": "logging.StreamHandler"}},
    "loggers": {"flow": {"handlers": ["console"], "level": "INFO"}},
}
