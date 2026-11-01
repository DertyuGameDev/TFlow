"""Native Grafana/Prometheus on loopback; Grafana is exposed by Django's gated proxy."""
import hashlib
import json
import os
from pathlib import Path
import pwd
import secrets
import shutil
import subprocess
import tarfile
import time
from urllib.request import urlopen

GRAFANA_URL = 'https://dl.grafana.com/grafana/release/13.3.0/grafana_13.3.0_40412481033_linux_amd64.tar.gz'
GRAFANA_SHA256 = 'cec8f98cc59bc1a1945833b652371a073be678c5c159a9b1695ad63c04fae5a7'
ORIGIN = 'https://hack-mmk-25-vm1-162f2c.teleport.t-education.com'


def write(path, content, mode=0o644):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content)
    path.chmod(mode)


def grafana_config(password):
    return f'''[server]
http_addr = 127.0.0.1
http_port = 13001
root_url = {ORIGIN}/grafana/
serve_from_sub_path = true
[paths]
data = /var/lib/tflow-grafana
logs = /var/log/tflow-grafana
provisioning = /etc/tflow/grafana-provisioning
[security]
admin_user = tflow-monitoring-admin
admin_password = {password}
[users]
allow_sign_up = false
auto_assign_org_role = Viewer
[auth]
disable_login_form = true
[auth.anonymous]
enabled = false
[auth.proxy]
enabled = true
header_name = X-WEBAUTH-USER
header_property = username
auto_sign_up = true
whitelist = 127.0.0.1
[live]
max_connections = 0
[analytics]
reporting_enabled = false
check_for_updates = false
[plugins]
preinstall_disabled = true
'''


def dashboard():
    queries = [('Доступность API', 'up{job="tflow"}', 'stat'),
               ('Запросы в секунду', 'sum(rate(tflow_http_requests_total[1m]))', 'timeseries'),
               ('Ошибки HTTP 5xx', 'sum(rate(tflow_http_requests_total{status=~"5.."}[1m]))', 'timeseries'),
               ('Время ответа p95', 'histogram_quantile(0.95, sum by (le) (rate(tflow_http_duration_seconds_bucket[1m])))', 'timeseries'),
               ('HTTP-ответы', 'sum by (status) (rate(tflow_http_requests_total[1m]))', 'timeseries'),
               ('Ожидание блокировки расписания p95', 'histogram_quantile(0.95, sum by (le) (rate(tflow_schedule_lock_wait_seconds_bucket[1m])))', 'timeseries')]
    return {'uid': 'tflow-production', 'title': 'ТФлоу · Production', 'schemaVersion': 39,
            'editable': False, 'refresh': '5s', 'time': {'from': 'now-15m', 'to': 'now'},
            'panels': [{'id': i + 1, 'title': title, 'type': kind,
                        'datasource': {'type': 'prometheus', 'uid': 'tflow-prometheus'},
                        'gridPos': {'x': (i % 2) * 12, 'y': (i // 2) * 8, 'w': 12, 'h': 8},
                        'targets': [{'expr': expr, 'refId': 'A', 'legendFormat': '{{status}}'}]}
                       for i, (title, expr, kind) in enumerate(queries)]}


def prepare_monitoring():
    def run(*args, **kwargs):
        return subprocess.run(args, check=True, **kwargs)

    config = Path('/etc/tflow')
    config.mkdir(exist_ok=True)
    token = config / 'metrics-token'
    if not token.exists():
        write(token, secrets.token_urlsafe(32), 0o600)
    write(config / 'monitoring.env', 'TFLOW_MONITORING_TOKEN=' + token.read_text().strip() +
          '\nTFLOW_GRAFANA_VIEWERS=\nTFLOW_GRAFANA_VIEWER_SHA256=58d8cf1d3b63cdbd12844dddbfa70ce7b0db6206e27dd95e8740d638d6fb9cf3\n', 0o600)
    write(config / 'prometheus.yml', '''global:
  scrape_interval: 5s
scrape_configs:
  - job_name: tflow
    metrics_path: /internal/metrics
    scheme: http
    authorization:
      credentials_file: /etc/tflow/metrics-token
    static_configs:
      - targets: ['127.0.0.1:8000']
''')
    # Prometheus is a distro package; keep its listener on loopback from first start.
    if not shutil.which('prometheus'):
        write('/etc/default/prometheus', 'ARGS="--config.file=/etc/tflow/prometheus.yml --web.listen-address=127.0.0.1:19090 --storage.tsdb.path=/var/lib/tflow-prometheus"\n')
        run('apt-get', 'update', '-qq')
        run('apt-get', 'install', '-y', '-o', 'Dpkg::Options::=--force-confold', '--no-install-recommends', 'prometheus',
            env={**os.environ, 'DEBIAN_FRONTEND': 'noninteractive'})
        run('systemctl', 'disable', '--now', 'prometheus')
    home = Path('/opt/tflow-grafana-13.3.0')
    if not (home / 'bin/grafana').is_file():
        archive = Path('/var/tmp/tflow-grafana.tar.gz')
        with urlopen(GRAFANA_URL, timeout=120) as source, archive.open('wb') as output:
            shutil.copyfileobj(source, output)
        if hashlib.sha256(archive.read_bytes()).hexdigest() != GRAFANA_SHA256:
            raise RuntimeError('Official Grafana archive checksum mismatch')
        staging = Path('/var/tmp/tflow-grafana-extract')
        staging.mkdir(exist_ok=True)
        with tarfile.open(archive) as bundle:
            bundle.extractall(staging, filter='data')
        candidates = list(staging.glob('*/bin/grafana'))
        if len(candidates) != 1:
            raise RuntimeError('Unexpected Grafana archive layout')
        candidates[0].parent.parent.rename(home)
        archive.unlink()
        staging.rmdir()
    for user in ('tflow-grafana',):
        try:
            pwd.getpwnam(user)
        except KeyError:
            run('useradd', '--system', '--no-create-home', '--shell', '/usr/sbin/nologin', user)
    for path, user in [('/var/lib/tflow-grafana', 'tflow-grafana'),
                       ('/var/log/tflow-grafana', 'tflow-grafana'),
                       ('/var/lib/tflow-prometheus', 'prometheus')]:
        Path(path).mkdir(exist_ok=True)
        shutil.chown(path, user=user, group=user)
    shutil.chown(token, user='root', group='prometheus')
    token.chmod(0o640)
    secret = config / 'grafana-admin-password'
    if not secret.exists():
        write(secret, secrets.token_urlsafe(32), 0o600)
    write(config / 'grafana.ini', grafana_config(secret.read_text().strip()), 0o640)
    shutil.chown(config / 'grafana.ini', user='root', group='tflow-grafana')
    provisioning = config / 'grafana-provisioning'
    write(provisioning / 'datasources/tflow.yaml', '''apiVersion: 1
datasources:
  - name: ТФлоу Prometheus
    uid: tflow-prometheus
    type: prometheus
    access: proxy
    url: http://127.0.0.1:19090
    isDefault: true
    editable: false
''')
    write(provisioning / 'dashboards/tflow.yaml', '''apiVersion: 1
providers:
  - name: ТФлоу
    folder: ТФлоу
    type: file
    disableDeletion: true
    options:
      path: /etc/tflow/grafana-dashboards
''')
    write(config / 'grafana-dashboards/tflow.json', json.dumps(dashboard(), ensure_ascii=False))
    write('/etc/systemd/system/tflow-grafana.service', f'''[Unit]
Description=TFlow Grafana
After=network-online.target
[Service]
User=tflow-grafana
Group=tflow-grafana
WorkingDirectory={home}
ExecStart={home}/bin/grafana server --homepath={home} --config=/etc/tflow/grafana.ini
Restart=always
RestartSec=3
[Install]
WantedBy=multi-user.target
''')
    write('/etc/systemd/system/tflow-prometheus.service', '''[Unit]
Description=TFlow Prometheus
After=network-online.target
[Service]
User=prometheus
Group=prometheus
ExecStart=/usr/bin/prometheus --config.file=/etc/tflow/prometheus.yml --web.listen-address=127.0.0.1:19090 --storage.tsdb.path=/var/lib/tflow-prometheus --storage.tsdb.retention.time=7d
Restart=always
RestartSec=3
[Install]
WantedBy=multi-user.target
''')
    write(config / 'gunicorn-monitoring.py', 'from prometheus_client import multiprocess\ndef child_exit(server, worker):\n    multiprocess.mark_process_dead(worker.pid)\n')
    write('/etc/systemd/system/tflow.service.d/grafana.conf', '''[Service]
EnvironmentFile=/etc/tflow/monitoring.env
Environment=PROMETHEUS_MULTIPROC_DIR=/run/tflow-metrics
Environment="GUNICORN_CMD_ARGS=--config /etc/tflow/gunicorn-monitoring.py"
RuntimeDirectory=tflow-metrics
RuntimeDirectoryMode=0750
ExecStartPre=/usr/bin/find /run/tflow-metrics -maxdepth 1 -type f -name *.db -delete
''')
    run('/usr/bin/promtool', 'check', 'config', '/etc/tflow/prometheus.yml')
    run('systemctl', 'daemon-reload')
    run('systemctl', 'enable', 'tflow-prometheus', 'tflow-grafana')
    run('systemctl', 'restart', 'tflow-prometheus', 'tflow-grafana')
    for attempt in range(60):
        try:
            with urlopen('http://127.0.0.1:13001/grafana/api/health', timeout=2) as response:
                if json.load(response).get('database') == 'ok':
                    return
        except OSError:
            pass
        time.sleep(1)
    raise RuntimeError('Grafana did not become healthy')
