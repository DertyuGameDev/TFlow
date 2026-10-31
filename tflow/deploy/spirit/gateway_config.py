"""Allow only this VM's authenticated Teleport gateway without weakening HTTPS."""

import json
import os
from pathlib import Path
import sys
import tempfile
import time

from control import HOST

GATEWAY_HOST = HOST.split(".vm.prodcontest.com")[0] + ".teleport.t-education.com"


def configure(path, backup_directory, hostname):
    if hostname != GATEWAY_HOST:
        raise ValueError("The gateway does not belong to the reviewed VM")
    original = path.read_text()
    lines = original.splitlines()
    values = dict(line.split("=", 1) for line in lines if line and not line.startswith("#"))
    if HOST not in values.get("DJANGO_ALLOWED_HOSTS", "").split(","):
        raise ValueError("Environment does not identify this VM")
    updates = {}
    for key, item in [("DJANGO_ALLOWED_HOSTS", hostname), ("DJANGO_CSRF_TRUSTED_ORIGINS", "https://" + hostname)]:
        entries = [entry for entry in values.get(key, "").split(",") if entry]
        if item not in entries:
            updates[key] = ",".join([*entries, item])
    # Links embedded in QR images must use the browser-facing gateway URL.
    origin = "https://" + hostname
    if values.get("TFLOW_PUBLIC_URL") != origin:
        updates["TFLOW_PUBLIC_URL"] = origin
    if not updates:
        return False
    backup_directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    backup = backup_directory / f"before-gateway-{time.time_ns()}.env"
    descriptor = os.open(backup, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w") as stream:
        stream.write(original)
    present = set()
    for index, line in enumerate(lines):
        key = line.split("=", 1)[0]
        if key in updates:
            if key in present:
                raise ValueError("Ambiguous duplicate environment setting")
            lines[index] = key + "=" + updates[key]
            present.add(key)
    lines.extend(key + "=" + value for key, value in updates.items() if key not in present)
    with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, delete=False) as temporary:
        temporary.write("\n".join(lines) + "\n")
        temporary_path = Path(temporary.name)
    temporary_path.chmod(0o600)
    temporary_path.replace(path)
    return True


if __name__ == "__main__":
    if os.geteuid() != 0 or len(sys.argv) != 2:
        raise SystemExit("Run as root with the exact Teleport gateway hostname")
    changed = configure(Path("/etc/tflow/app.env"), Path("/var/backups/tflow"), sys.argv[1])
    print(json.dumps({"changed": changed}))
