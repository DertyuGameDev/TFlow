"""One-time setup of a dedicated Ubuntu 24.04 VM. Run as root with its hostname."""

import os
from pathlib import Path
import re
import secrets
import subprocess
import sys

if os.geteuid() != 0 or len(sys.argv) != 2:
    raise SystemExit("Usage: sudo python3 bootstrap.py <public-hostname>")
hostname = sys.argv[1]
if not re.fullmatch(r"[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?", hostname) or "." not in hostname:
    raise SystemExit("Use the VM's public DNS hostname")


def run(*args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


packages = ["python3-venv", "postgresql", "caddy", "git", "ca-certificates", "curl"]
installed = subprocess.run(["dpkg-query", "-W", "-f=${Status}\n", *packages], capture_output=True, text=True)
if installed.returncode or installed.stdout.count("install ok installed") != len(packages):
    run("apt-get", "update", "-qq")
    run("apt-get", "install", "-y", *packages, env={**os.environ, "DEBIAN_FRONTEND": "noninteractive"})

if subprocess.run(["id", "tflow"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode:
    run("useradd", "--system", "--home-dir", "/var/lib/tflow", "--shell", "/usr/sbin/nologin", "tflow")
for path in ("/srv/tflow", "/srv/tflow/releases", "/srv/tflow/incoming", "/etc/tflow", "/var/backups/tflow"):
    Path(path).mkdir(parents=True, exist_ok=True)
Path("/etc/tflow").chmod(0o700)
Path("/var/backups/tflow").chmod(0o700)
Path("/var/lib/tflow").mkdir(exist_ok=True)
run("chown", "tflow:tflow", "/var/lib/tflow")
run("chmod", "750", "/var/lib/tflow")
run("systemctl", "enable", "--now", "postgresql")

environment = Path("/etc/tflow/app.env")
if not environment.exists():
    exists = subprocess.check_output(["runuser", "-u", "postgres", "--", "psql", "-tAc", "SELECT 1 FROM pg_roles WHERE rolname='tflow'"], text=True).strip()
    if exists:
        raise SystemExit("Database role tflow already exists without a managed environment; inspect before proceeding")
    password = secrets.token_urlsafe(40)
    # The generated password contains no SQL quotes; neither secret is logged.
    run("runuser", "-u", "postgres", "--", "psql", "-v", "ON_ERROR_STOP=1", input=f"CREATE USER tflow WITH PASSWORD '{password}';\nCREATE DATABASE tflow OWNER tflow;\n", text=True)
    values = {
        "DJANGO_DEBUG": "0",
        "DJANGO_SECRET_KEY": secrets.token_urlsafe(64),
        "DATABASE_URL": f"postgresql://tflow:{password}@127.0.0.1:5432/tflow",
        "DJANGO_ALLOWED_HOSTS": hostname + ",127.0.0.1,localhost",
        "DJANGO_CSRF_TRUSTED_ORIGINS": "https://" + hostname,
        "DJANGO_TRUST_PROXY": "1",
        "PYTHONDONTWRITEBYTECODE": "1",
        "PYTHONUNBUFFERED": "1",
    }
    fd = os.open(environment, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(fd, "w") as stream:
        stream.write("\n".join(f"{key}={value}" for key, value in values.items()) + "\n")
else:
    existing_host = next(line.split("=", 1)[1].split(",")[0] for line in environment.read_text().splitlines() if line.startswith("DJANGO_ALLOWED_HOSTS="))
    if existing_host != hostname:
        raise SystemExit("The existing installation uses a different hostname; configure its DNS and hosts explicitly")

Path("/etc/systemd/system/tflow.service").write_text("""[Unit]
Description=ТФлоу Django application
After=network.target postgresql.service
Requires=postgresql.service

[Service]
User=tflow
Group=tflow
WorkingDirectory=/srv/tflow/current/tflow/backend
EnvironmentFile=/etc/tflow/app.env
ExecStart=/srv/tflow/current/.venv/bin/gunicorn config.wsgi:application --bind 127.0.0.1:8000 --workers 2 --threads 4 --timeout 60 --access-logfile - --error-logfile -
Restart=on-failure
RestartSec=3
TimeoutStopSec=30
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/tflow
UMask=0027

[Install]
WantedBy=multi-user.target
""")
caddy = Path("/etc/caddy/Caddyfile")
old = caddy.read_text() if caddy.exists() else ""
if old and "Managed by TFlow" not in old and "/usr/share/caddy" not in old:
    raise SystemExit("Caddy already has a custom configuration; inspect it before changing the proxy")
caddy.write_text(f"# Managed by TFlow\n{hostname} {{\n    tls {{\n        issuer acme\n    }}\n    encode zstd gzip\n    reverse_proxy 127.0.0.1:8000\n}}\n")
run("caddy", "validate", "--config", str(caddy))
run("systemctl", "daemon-reload")
run("systemctl", "enable", "tflow", "caddy")
run("systemctl", "reload-or-restart", "caddy")
print(f"VM configured for https://{hostname}; install a verified CI release next.")
