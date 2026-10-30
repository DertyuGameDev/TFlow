import os
import sys
import subprocess
from pathlib import Path

os.umask(0o077)
backend = Path(__file__).resolve().parent
subprocess.run(
    [sys.executable, str(backend / "manage.py"), "migrate", "--noinput"], check=True
)
os.execvp(
    "gunicorn",
    [
        "gunicorn",
        "--chdir",
        str(backend),
        "config.wsgi:application",
        "--bind",
        "0.0.0.0:" + os.environ.get("PORT", "8000"),
        "--workers",
        os.environ.get("WEB_CONCURRENCY", "2"),
        "--threads",
        "4",
        "--access-logfile",
        "-",
        "--error-logfile",
        "-",
    ],
)
