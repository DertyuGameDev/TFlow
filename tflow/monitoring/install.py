"""Plan/apply monitoring on the existing Linux VM. Never provisions or replaces a VM."""
import argparse
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess


def units(checkout):
    return {
        '/etc/systemd/system/tflow-monitoring.service': '''[Unit]
Description=TFlow telemetry collectors and dashboards
Requires=docker.service
After=docker.service network-online.target
[Service]
Type=simple
WorkingDirectory=/opt/tflow-monitoring
ExecStart=/usr/bin/docker compose up --remove-orphans
ExecStop=/usr/bin/docker compose down
Restart=always
RestartSec=10
[Install]
WantedBy=multi-user.target
''',
        '/etc/systemd/system/tflow.service.d/monitoring.conf': '''[Service]
EnvironmentFile=/etc/tflow/monitoring.env
Environment=PROMETHEUS_MULTIPROC_DIR=/run/tflow-metrics
RuntimeDirectory=tflow-metrics
RuntimeDirectoryMode=0750
ExecStartPre=/bin/sh -c 'rm -f /run/tflow-metrics/*.db'
ExecStart=
ExecStart=/srv/tflow/current/.venv/bin/gunicorn config.wsgi:application --config /opt/tflow-monitoring/gunicorn.conf.py --bind 127.0.0.1:8000 --workers 2 --threads 4 --timeout 60 --access-logfile - --error-logfile -
''',
        '/etc/systemd/system/tflow-reminders.service': '''[Unit]
Description=TFlow due activity reminders
After=tflow.service postgresql.service
[Service]
Type=oneshot
User=tflow
Group=tflow
EnvironmentFile=/etc/tflow/app.env
EnvironmentFile=/etc/tflow/monitoring.env
WorkingDirectory=/srv/tflow/current/tflow/backend
ExecStart=/srv/tflow/current/.venv/bin/python manage.py send_activity_reminders
''',
        '/etc/systemd/system/tflow-reminders.timer': '''[Unit]
Description=Check upcoming TFlow activities every minute
[Timer]
OnBootSec=1m
OnUnitActiveSec=1m
Unit=tflow-reminders.service
[Install]
WantedBy=timers.target
''',
        '/etc/logrotate.d/tflow': '''/var/log/tflow/*.jsonl {
    daily
    rotate 7
    compress
    delaycompress
    missingok
    notifempty
    create 0640 tflow tflow
}
''',
    }


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply',action='store_true',help='Install on this existing VM as root; default prints plan only')
    parser.add_argument('--webhook-url',help='HTTPS Alertmanager-compatible team receiver (keep secrets in a protected file instead of the shell history)')
    args=parser.parse_args()
    source=Path(__file__).resolve().parent
    plan=units(source.parent)
    if not args.apply:
        print(json.dumps({'mode':'plan','files':list(plan),'services':['tflow-monitoring','tflow-reminders.timer'],'persistent_data':'Docker volumes and /var/log/tflow','required':['root','Docker Compose','existing tflow release with telemetry migrations']},indent=2))
        return
    if os.geteuid()!=0: parser.error('--apply requires root on the target VM')
    if not Path('/etc/tflow/app.env').is_file():parser.error('Existing application configuration is required; no infrastructure is provisioned')
    subprocess.run(['docker','compose','version'],check=True,capture_output=True)
    subprocess.run(['/srv/tflow/current/.venv/bin/python','-c','import prometheus_client, flow.observability'],cwd='/srv/tflow/current/tflow/backend',check=True)
    if args.webhook_url and not args.webhook_url.startswith('https://'):parser.error('External webhook requires HTTPS')
    target=Path('/opt/tflow-monitoring');target.mkdir(parents=True,exist_ok=True)
    for path in source.rglob('*'):
        relative=path.relative_to(source)
        if not path.is_file() or 'secrets' in relative.parts or '__pycache__' in relative.parts or path.name.startswith('.env'):continue
        dest=target/relative;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(path,dest)
    private=target/'secrets';private.mkdir(exist_ok=True,mode=0o700)
    (private/'inbox').mkdir(exist_ok=True, mode=0o700)
    token_path=private/'metrics-token'
    if not token_path.exists():token_path.write_text(secrets.token_urlsafe(32))
    token_path.chmod(0o644) # directory remains root-only, Docker mounts this file read-only
    env=target/'.env'
    if not env.exists():env.write_text('GF_SECURITY_ADMIN_USER=tflow\nGF_SECURITY_ADMIN_PASSWORD='+secrets.token_urlsafe(24)+'\n')
    env.chmod(0o600)
    alert_config=private/'alertmanager.yml'
    if args.webhook_url or not alert_config.exists():
        url=args.webhook_url or 'http://127.0.0.1:9094/alerts'
        alert_config.write_text('route:\n  receiver: team\n  group_by: [alertname]\n  group_wait: 10s\n  group_interval: 1m\n  repeat_interval: 4h\nreceivers:\n  - name: team\n    webhook_configs:\n      - url: '+json.dumps(url)+'\n        send_resolved: true\n')
    logdir=Path('/var/log/tflow');logdir.mkdir(exist_ok=True)
    shutil.chown(logdir,user='tflow',group='tflow');logdir.chmod(0o755)
    logfile=logdir/'tflow.jsonl';logfile.touch(exist_ok=True);shutil.chown(logfile,user='tflow',group='tflow');logfile.chmod(0o640)
    config=Path('/etc/tflow/monitoring.env')
    if config.exists():shutil.copy2(config,config.with_suffix('.env.backup'))
    config.write_text('TFLOW_MONITORING_TOKEN='+token_path.read_text().strip()+'\nTFLOW_LOG_FILE=/var/log/tflow/tflow.jsonl\n');config.chmod(0o600)
    compose=target/'compose.yaml';compose.write_text(compose.read_text().replace('../backend/data/logs:/logs:ro','/var/log/tflow:/logs:ro'))
    for name,content in plan.items():
        path=Path(name);path.parent.mkdir(parents=True,exist_ok=True)
        if path.exists():shutil.copy2(path,path.with_suffix(path.suffix+'.backup'))
        path.write_text(content)
    subprocess.run(['docker','compose','config','--quiet'],cwd=target,check=True)
    subprocess.run(['systemctl','daemon-reload'],check=True)
    subprocess.run(['systemctl','restart','tflow'],check=True)
    subprocess.run(['systemctl','enable','--now','tflow-monitoring.service','tflow-reminders.timer'],check=True)
    print('Installed locally on this VM. Grafana: SSH tunnel to localhost:3001; credentials: /opt/tflow-monitoring/.env. Verify targets and team delivery before declaring production ready.')

if __name__=='__main__':main()
