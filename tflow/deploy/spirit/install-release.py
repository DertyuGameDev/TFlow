"""Install an exact GitLab CI release, migrate PostgreSQL and switch atomically."""

from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tarfile
import time
import urllib.request
from runtime_check import verify_runtime
from broadcast_service import prepare_service, enabled_environment, ensure_no_live_broadcast

if os.geteuid() != 0 or len(sys.argv) != 3:
    raise SystemExit("Usage: sudo python3 install-release.py <manifest.json> <tflow-release.tar.gz>")
# A deployment must never restart an encoder during a live webinar.
ensure_no_live_broadcast()
manifest = json.loads(Path(sys.argv[1]).read_text())
archive = Path(sys.argv[2])
sha = manifest.get("commit", "")
if not re.fullmatch(r"[0-9a-f]{40}", sha):
    raise SystemExit("A CI manifest with the full commit SHA is required")
if archive.stat().st_size > 100 * 1024 * 1024 or hashlib.sha256(archive.read_bytes()).hexdigest() != manifest.get("sha256"):
    raise SystemExit("Release checksum or size is invalid")

root = Path("/srv/tflow")
release = root / "releases" / sha
if release.exists():
    raise SystemExit("This release directory already exists; inspect it instead of overwriting")
with tarfile.open(archive) as bundle:
    members = bundle.getmembers()
    if len(members) > 5000 or sum(member.size for member in members) > 500 * 1024 * 1024:
        raise SystemExit("Release is unexpectedly large")
    for member in members:
        parts = Path(member.name).parts
        if not member.isfile() or len(parts) < 3 or parts[0] != "tflow" or parts[1] not in {"backend", "dist", "public", "monitoring"} or ".." in parts or Path(member.name).is_absolute():
            raise SystemExit("Release contains an unsupported path or file type")
    release.mkdir(mode=0o755)
    bundle.extractall(release, members=members, filter="data")

app = release / "tflow" / "backend"
for path in (app / "data", app / "staticfiles"):
    if path.exists() or path.is_symlink():
        raise SystemExit("Release unexpectedly includes runtime data")
(app / "data").symlink_to("/var/lib/tflow", target_is_directory=True)
environment = {**os.environ, "HOME": "/var/lib/tflow"}
for line in Path("/etc/tflow/app.env").read_text().splitlines():
    if line and not line.startswith("#"):
        key, value = line.split("=", 1)
        environment[key] = value


def run(*args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def as_app(*args):
    run("runuser", "-u", "tflow", "--", *map(str, args), cwd=app, env=environment)


# Only the application user executes dependencies and application management code.
run("chown", "-hR", "tflow:tflow", str(release))
as_app("python3", "-m", "venv", release / ".venv")
python = release / ".venv" / "bin" / "python"
as_app(python, "-m", "pip", "install", "--disable-pip-version-check", "--no-cache-dir", "-r", app / "requirements.lock.txt")
stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
backup = Path("/var/backups/tflow") / f"{stamp}-{sha[:8]}.dump"
fd = os.open(backup, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, "wb") as stream:
    run("runuser", "-u", "postgres", "--", "pg_dump", "--format=custom", "tflow", stdout=stream)
as_app(python, app / "manage.py", "migrate", "--noinput")
as_app(python, app / "manage.py", "collectstatic", "--noinput")
# Prepare dependencies before changing the running release. Failure here leaves
# the existing application and all its services running.
prepare_service()
env_path = Path("/etc/tflow/app.env")
env_before = env_path.read_text()
env_backup = Path("/var/backups/tflow") / f"{stamp}-{sha[:8]}-app.env"
descriptor = os.open(env_backup, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(descriptor, "w") as stream:
    stream.write(env_before)
env_path.write_text(enabled_environment(env_before)); env_path.chmod(0o600)
environment["TFLOW_HTTP_BROADCAST"] = "1"
run("chown", "-hR", "root:root", str(release))
run("chmod", "-R", "go-w", str(release))

current = root / "current"
previous = current.resolve() if current.is_symlink() else None
candidate = root / "current.next"
candidate.unlink(missing_ok=True)
candidate.symlink_to(release, target_is_directory=True)
candidate.replace(current)
healthy = False
try:
    run("systemctl", "restart", "tflow-broadcast")
    run("systemctl", "restart", "tflow")
    host = environment["DJANGO_ALLOWED_HOSTS"].split(",")[0]
    for attempt in range(30):
        try:
            req = urllib.request.Request("http://127.0.0.1:8000/api/health", headers={"Host": host, "X-Forwarded-Proto": "https"})
            with urllib.request.urlopen(req, timeout=2) as response:
                if response.status == 200:
                    verify_runtime(manifest, host)
                    heartbeat = Path("/var/lib/tflow/broadcasts/worker")
                    if not heartbeat.exists() or time.time() - heartbeat.stat().st_mtime > 10:
                        raise RuntimeError("HTTPS encoder worker is not ready")
                    (root / "deployed.json").write_text(json.dumps(manifest, indent=2) + "\n")
                    print(f"Release {sha} is healthy at https://{host}")
                    healthy = True
                    break
        except Exception:
            time.sleep(1)
finally:
    if not healthy:
        if previous:
            subprocess.run(["systemctl", "stop", "tflow-broadcast"], check=False)
            env_path.write_text(env_before); env_path.chmod(0o600)
            candidate.symlink_to(previous, target_is_directory=True)
            candidate.replace(current)
            run("systemctl", "restart", "tflow")
            if (previous / "tflow/backend/flow/management/commands/run_broadcast_worker.py").exists():
                run("systemctl", "restart", "tflow-broadcast")
            else:
                subprocess.run(["systemctl", "disable", "tflow-broadcast"], check=False)
        raise SystemExit("Health check failed; previous application release restored when available. Database backup retained.")
