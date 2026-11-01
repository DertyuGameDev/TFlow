"""Install the existing VM's notification worker without depending on Docker."""
from pathlib import Path
import subprocess

UNIT='''[Unit]
Description=TFlow reminders and Web Push delivery
After=network-online.target postgresql.service tflow.service
[Service]
Type=simple
User=tflow
Group=tflow
WorkingDirectory=/srv/tflow/current/tflow/backend
EnvironmentFile=/etc/tflow/app.env
ExecStart=/srv/tflow/current/.venv/bin/python manage.py run_notification_worker
Restart=always
RestartSec=5
TimeoutStopSec=30
Nice=10
CPUQuota=25%
MemoryMax=256M
TasksMax=32
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/tflow
[Install]
WantedBy=multi-user.target
'''


def prepare_service():
    path=Path('/etc/systemd/system/tflow-notifications.service')
    path.write_text(UNIT);path.chmod(0o644)
    subprocess.run(['systemctl','daemon-reload'],check=True)
    subprocess.run(['systemctl','enable','tflow-notifications'],check=True)


def enabled_environment(text):
    values={
        'TFLOW_WEB_PUSH':'1',
        'TFLOW_WEB_PUSH_PRIVATE_KEY':'/var/lib/tflow/webpush/private.pem',
        'TFLOW_WEB_PUSH_PUBLIC_KEY':'/var/lib/tflow/webpush/public.key',
        'TFLOW_WEB_PUSH_SUBJECT':'https://hack-mmk-25-vm1-162f2c.teleport.t-education.com',
        'TFLOW_NOTIFICATION_WORKER_ROOT':'/var/lib/tflow/notification-worker',
    }
    lines=[line for line in text.splitlines() if line.split('=',1)[0] not in values]
    return '\n'.join([*lines,*(key+'='+value for key,value in values.items())])+'\n'
