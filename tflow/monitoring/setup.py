"""Generate local credentials; does not contact third parties or change deployment."""
import argparse
import json
from pathlib import Path
import secrets

parser = argparse.ArgumentParser()
parser.add_argument('--webhook-url', help='Optional team webhook compatible with Alertmanager JSON; no URL means local durable inbox')
args = parser.parse_args()
root = Path(__file__).resolve().parent
private = root / 'secrets'
private.mkdir(exist_ok=True, mode=0o700)
logdir = root.parent / 'backend/data/logs'
logdir.mkdir(exist_ok=True, parents=True)
(logdir / 'tflow.jsonl').touch(exist_ok=True)
for path, content in [
    (private / 'metrics-token', secrets.token_urlsafe(32)),
    (root / '.env', 'GF_SECURITY_ADMIN_USER=tflow\nGF_SECURITY_ADMIN_PASSWORD=' + secrets.token_urlsafe(24) + '\n'),
]:
    if not path.exists():
        path.write_text(content)
        path.chmod(0o600)
url = args.webhook_url or 'http://127.0.0.1:9094/alerts'
if not url.startswith(('https://', 'http://127.0.0.1:')):
    parser.error('Use HTTPS for external alert receivers')
config = 'route:\n  receiver: team\n  group_by: [alertname]\n  group_wait: 10s\n  group_interval: 1m\n  repeat_interval: 4h\nreceivers:\n  - name: team\n    webhook_configs:\n      - url: ' + json.dumps(url) + '\n        send_resolved: true\n'
# Alertmanager/Prometheus run as non-root; compose mounts secrets individually.
if args.webhook_url or not (private / 'alertmanager.yml').exists():
    (private / 'alertmanager.yml').write_text(config)
    (private / 'alertmanager.yml').chmod(0o644)
(private / 'metrics-token').chmod(0o644)
env = root.parent / 'backend/.env.monitoring'
env.write_text('TFLOW_MONITORING_TOKEN=' + (private / 'metrics-token').read_text().strip() + '\nTFLOW_LOG_FILE=' + str(logdir / 'tflow.jsonl') + '\n')
env.chmod(0o600)
print('Credentials prepared in monitoring/.env and monitoring/secrets. See docs/observability.md.')
