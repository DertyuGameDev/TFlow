"""Deploy a successful GitLab package job to the dedicated VM.

Required GitLab FILE variables: TFLOW_VM_SSH_KEY and TFLOW_VM_KNOWN_HOSTS.
Never place a private key in the repository, command line, or job trace.
"""
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile


def main():
    root = Path(__file__).resolve().parents[3]
    sha = os.environ.get("CI_COMMIT_SHA", "")
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise SystemExit("Run this command from a GitLab pipeline with a full commit SHA")
    host = str(ipaddress.IPv4Address(os.environ.get("TFLOW_VM_HOST", "158.160.209.13")))
    hostname = os.environ.get("TFLOW_VM_HOSTNAME", "hack-mmk-25-vm1-162f2c.vm.prodcontest.com")
    if not re.fullmatch(r"[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?", hostname):
        raise SystemExit("Invalid VM hostname")
    files = [root / "release" / name for name in ("manifest.json", "tflow-release.tar.gz")]
    manifest = json.loads(files[0].read_text())
    if manifest["commit"] != sha or hashlib.sha256(files[1].read_bytes()).hexdigest() != manifest["sha256"]:
        raise SystemExit("Package job artifact does not match this pipeline")
    sources = {}
    for name in ("TFLOW_VM_SSH_KEY", "TFLOW_VM_KNOWN_HOSTS"):
        value = os.environ.get(name, "")
        source = Path(value) if value else None
        if source is None or not source.is_file():
            raise SystemExit(f"Set {name} as a protected GitLab FILE variable")
        sources[name] = source
    with tempfile.TemporaryDirectory(prefix="tflow-ci-ssh-") as temporary:
        directory = Path(temporary)
        key, known_hosts = directory / "key", directory / "known_hosts"
        for path, source in ((key, sources["TFLOW_VM_SSH_KEY"]), (known_hosts, sources["TFLOW_VM_KNOWN_HOSTS"])):
            shutil.copyfile(source, path)
            path.chmod(0o600)
        options = ["-i", str(key), "-o", "IdentitiesOnly=yes", "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", "-o", "StrictHostKeyChecking=yes", "-o", f"UserKnownHostsFile={known_hosts}"]
        target = "ubuntu@" + host
        incoming = "/srv/tflow/incoming/" + sha
        def remote(command):
            subprocess.run(["ssh", *options, target, command], check=True)
        remote(f"sudo install -d -m 0750 -o ubuntu -g ubuntu {incoming}")
        scripts = Path(__file__).resolve().parent
        subprocess.run(["scp", *options, *(str(path) for path in files), str(scripts / "install-release.py"), str(scripts / "runtime_check.py"), str(scripts / "configure-video.py"), f"{target}:{incoming}/"], check=True)
        remote(f"sudo python3 {incoming}/install-release.py {incoming}/manifest.json {incoming}/tflow-release.tar.gz")
        if os.environ.get("TFLOW_CONFIGURE_VIDEO", "0") == "1":
            remote(f"sudo python3 {incoming}/configure-video.py --hostname {hostname} --public-ip {host} --apply")
        remote("sudo systemd-run --quiet --wait --pipe --collect --property=User=tflow --property=Group=tflow --property=EnvironmentFile=/etc/tflow/app.env --property=WorkingDirectory=/srv/tflow/current/tflow/backend /srv/tflow/current/.venv/bin/python manage.py check_webinars")
    print(f"VM release {sha} deployed; authenticated LiveKit API check passed.")
    print("Complete the external host/viewer media check before declaring the webinar service healthy.")


if __name__ == "__main__":
    main()
