"""Apply the owner's single data-reset request once on the existing VM."""
import json
import os
from pathlib import Path
import re

from control import VM_ID

STATE = Path('/var/lib/tflow/maintenance')
EXPECTED = {'users': 12, 'events': 11, 'activities': 30, 'clubs': 4}


def pending_request(path, state=STATE):
    if not path.exists():
        return None
    request = json.loads(path.read_text())
    if (set(request) != {'request_id', 'vm_id', 'operation', 'backup'}
            or not isinstance(request['request_id'], str)
            or not re.fullmatch(r'[a-z0-9-]{1,80}', request['request_id'])
            or request['vm_id'] != VM_ID
            or request['operation'] != 'replace_all_with_jury_fixtures'
            or request['backup'] is not False):
        raise RuntimeError('Unsupported defense data request; no data changed')
    receipt = state / (request['request_id'] + '.json')
    if receipt.exists():
        value = json.loads(receipt.read_text())
        if value.get('request_id') == request['request_id'] and value.get('status') == 'complete':
            return None
        raise RuntimeError('Defense reset was already started; inspect its receipt before any retry')
    return request


def apply_request(request, sha, python, app, as_app, run, state=STATE):
    state.mkdir(mode=0o700, parents=True, exist_ok=True)
    receipt = state / (request['request_id'] + '.json')
    descriptor = os.open(receipt, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    value = {'request_id': request['request_id'], 'commit': sha, 'status': 'started'}
    with os.fdopen(descriptor, 'w') as stream:
        json.dump(value, stream)
    stopped = []
    try:
        for service in ('tflow-notifications', 'tflow-broadcast', 'tflow'):
            run('systemctl', 'stop', service)
            stopped.append(service)
        result = as_app(python, app / 'manage.py', 'prepare_defense', '--reset-all', '--yes',
                        capture_output=True, text=True)
        counts = json.loads(result.stdout.strip().splitlines()[-1])
        if counts != EXPECTED:
            raise RuntimeError('Defense fixture verification failed')
        value.update(status='complete', counts=counts)
        temporary = receipt.with_suffix('.next')
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, 'w') as stream:
            json.dump(value, stream)
        temporary.replace(receipt)
        print('Defense dataset installed once, without a database backup: ' + json.dumps(counts))
    except BaseException:
        for service in reversed(stopped):
            run('systemctl', 'restart', service)
        raise
