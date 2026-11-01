"""Install only the bounded HTTP encoder service; application rollback stays intact."""
from pathlib import Path
import shutil
import subprocess

UNIT = """[Unit]
Description=TFlow HTTPS broadcast encoder
After=network-online.target postgresql.service
Wants=network-online.target
[Service]
User=tflow
Group=tflow
WorkingDirectory=/srv/tflow/current/tflow/backend
EnvironmentFile=/etc/tflow/app.env
ExecStart=/srv/tflow/current/.venv/bin/python manage.py run_broadcast_worker
Restart=on-failure
RestartSec=3
KillMode=control-group
TimeoutStopSec=8
CPUQuota=150%
CPUWeight=20
MemoryMax=768M
TasksMax=64
Nice=10
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
PrivateDevices=true
ReadWritePaths=/var/lib/tflow
[Install]
WantedBy=multi-user.target
"""


def prepare_service():
    if not shutil.which("ffmpeg"):
        subprocess.run(["apt-get", "update", "-qq"], check=True, capture_output=True, timeout=120)
        subprocess.run(["apt-get", "install", "-y", "--no-install-recommends", "ffmpeg"], check=True, capture_output=True, timeout=180)
    subprocess.run(["ffmpeg", "-version"], check=True, capture_output=True, timeout=10)
    unit = Path("/etc/systemd/system/tflow-broadcast.service")
    unit.write_text(UNIT); unit.chmod(0o644)
    subprocess.run(["systemctl", "daemon-reload"], check=True)
    subprocess.run(["systemctl", "enable", "tflow-broadcast"], check=True)


def enabled_environment(text):
    lines = [line for line in text.splitlines() if not line.startswith("TFLOW_HTTP_BROADCAST=")]
    return "\n".join([*lines, "TFLOW_HTTP_BROADCAST=1"]) + "\n"


def ensure_no_live_broadcast():
    prefix = ["runuser", "-u", "postgres", "--", "psql", "-d", "tflow", "-tAc"]
    table = subprocess.run([*prefix, "SELECT to_regclass('public.flow_httpbroadcast')"],
                           check=True, capture_output=True, text=True).stdout.strip()
    if table:
        active = subprocess.run([*prefix,
            "SELECT count(*) FROM flow_httpbroadcast WHERE active AND last_chunk_at > now() - interval '30 seconds'"],
            check=True, capture_output=True, text=True).stdout.strip()
        if active != "0":
            raise RuntimeError("An HTTPS webinar is live; finish it before deploying. Current production was retained.")
