"""Configure a local LiveKit service behind the existing TFlow HTTPS proxy.

Dry-run by default. Run on the Ubuntu VM with --apply after deploying code
that supports LIVEKIT_API_URL. Existing application data is left untouched.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import io
import ipaddress
import json
import os
from pathlib import Path
import platform
import re
import secrets
import shutil
import subprocess
import tarfile
from urllib.request import Request, urlopen

VERSION = "1.13.11"
BINARY = Path("/usr/local/bin/tflow-livekit-server")
SERVICE = """[Unit]
Description=TFlow LiveKit media server
After=network-online.target
Wants=network-online.target

[Service]
User=tflow
Group=tflow
ExecStart=/usr/local/bin/tflow-livekit-server --config /etc/tflow/livekit.yaml
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
LimitNOFILE=65536
UMask=0077

[Install]
WantedBy=multi-user.target
"""


def video_config(public_ip, key, secret):
    return (
        "# Managed by TFlow video setup\nport: 7880\nbind_addresses: [127.0.0.1]\n"
        f"rtc:\n  tcp_port: 8001\n  udp_port: 8002\n  use_external_ip: false\n  node_ip: {public_ip}\n"
        f"keys:\n  {key}: {secret}\n"
    )


def proxy_config(current):
    if "# Managed by TFlow" not in current:
        raise ValueError("Caddyfile is not managed by TFlow; merge the /livekit/ proxy manually")
    marker = "    # TFlow LiveKit begin"
    if marker in current:
        return current
    original = "    reverse_proxy 127.0.0.1:8000"
    if current.count(original) != 1:
        raise ValueError("Expected one application reverse_proxy; inspect the existing Caddyfile")
    return current.replace(original, """    # TFlow LiveKit begin
    handle_path /livekit/* {
        reverse_proxy 127.0.0.1:7880
    }
    handle {
        reverse_proxy 127.0.0.1:8000
    }
    # TFlow LiveKit end""")


def update_environment(current, values):
    result = []
    pending = dict(values)
    for line in current.splitlines():
        key = line.split("=", 1)[0]
        if key in values:
            if key in pending:
                result.append(f"{key}={pending.pop(key)}")
        else:
            result.append(line)
    result.extend(f"{key}={value}" for key, value in pending.items())
    return "\n".join(result) + "\n"


def secure_write(path, content):
    temporary = path.with_name(path.name + "." + secrets.token_hex(8))
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as stream:
        stream.write(content)
    temporary.replace(path)


def read_url(url):
    request = Request(url, headers={"User-Agent": "TFlow-video-setup", "Accept": "application/json"})
    with urlopen(request, timeout=30) as response:
        return response.read()


def install_binary():
    if BINARY.exists():
        return
    arch = {"x86_64": "amd64", "aarch64": "arm64"}.get(platform.machine())
    if platform.system() != "Linux" or not arch:
        raise RuntimeError("This installer supports Linux amd64/arm64")
    release = json.loads(read_url(f"https://api.github.com/repos/livekit/livekit/releases/tags/v{VERSION}"))
    assets = {item["name"]: item["browser_download_url"] for item in release["assets"]}
    filename = f"livekit_{VERSION}_linux_{arch}.tar.gz"
    checksums = read_url(assets["checksums.txt"]).decode()
    expected = next(line.split()[0] for line in checksums.splitlines() if line.split()[-1].lstrip("*") == filename)
    archive = read_url(assets[filename])
    if hashlib.sha256(archive).hexdigest() != expected:
        raise RuntimeError("Official LiveKit checksum does not match")
    with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz") as bundle:
        member = next(item for item in bundle.getmembers() if item.isfile() and Path(item.name).name == "livekit-server")
        if member.size > 150 * 1024 * 1024:
            raise RuntimeError("Unexpected LiveKit executable size")
        executable = bundle.extractfile(member).read()
    temporary = BINARY.with_suffix(".next")
    temporary.write_bytes(executable)
    temporary.chmod(0o755)
    temporary.replace(BINARY)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hostname", required=True)
    parser.add_argument("--public-ip", required=True)
    parser.add_argument("--apply", action="store_true", help="Apply on the VM as root; otherwise only print the plan")
    args = parser.parse_args()
    if not re.fullmatch(r"[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?", args.hostname) or "." not in args.hostname:
        parser.error("Use the public DNS hostname, without protocol or path")
    address = ipaddress.ip_address(args.public_ip)
    if address.version != 4 or not address.is_global:
        parser.error("Use the VM's public IPv4 address")
    print(f"Browser: wss://{args.hostname}/livekit; private API: http://127.0.0.1:7880")
    print("Media: TCP 8001, UDP 8002. Check these inbound rules in Spirit and the guest firewall.")
    print("HTTPS and a trusted certificate must already work. Restrictive networks may also require TURN.")
    if not args.apply:
        print("Dry run. Add --apply on the Ubuntu VM to install and configure the services.")
        return
    if os.geteuid() != 0:
        parser.error("Run --apply as root on the VM")
    environment = Path("/etc/tflow/app.env")
    proxy = Path("/etc/caddy/Caddyfile")
    original_env = environment.read_text()
    env = dict(line.split("=", 1) for line in original_env.splitlines() if line and not line.startswith("#") and "=" in line)
    if args.hostname not in env.get("DJANGO_ALLOWED_HOSTS", "").split(","):
        raise SystemExit("Hostname is not part of the installed TFlow configuration")
    public_url = f"wss://{args.hostname}/livekit"
    if env.get("LIVEKIT_URL") and env["LIVEKIT_URL"] != public_url:
        raise SystemExit("Another media server is already configured. Inspect it before replacing the connection.")
    original_proxy = proxy.read_text()
    updated_proxy = proxy_config(original_proxy)
    values = {
        "LIVEKIT_URL": public_url,
        "LIVEKIT_API_URL": "http://127.0.0.1:7880",
        "LIVEKIT_API_KEY": env.get("LIVEKIT_API_KEY") or "tflow_" + secrets.token_hex(12),
        "LIVEKIT_API_SECRET": env.get("LIVEKIT_API_SECRET") or secrets.token_urlsafe(48),
    }
    if len(values["LIVEKIT_API_SECRET"]) < 32 or values["LIVEKIT_API_KEY"] == "devkey":
        raise SystemExit("Development credentials are not accepted; replace them with production credentials first")
    install_binary()
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    backup = Path("/var/backups/tflow") / f"video-{stamp}"
    backup.mkdir(parents=True, mode=0o700)
    backup.chmod(0o700)
    for source in (environment, proxy, Path("/etc/tflow/livekit.yaml"), Path("/etc/systemd/system/tflow-livekit.service")):
        if source.exists():
            target = backup / source.name
            shutil.copy2(source, target)
            target.chmod(0o600)
    config = Path("/etc/tflow/livekit.yaml")
    secure_write(config, video_config(str(address), values["LIVEKIT_API_KEY"], values["LIVEKIT_API_SECRET"]))
    service = Path("/etc/systemd/system/tflow-livekit.service")
    # /etc/tflow stays root-only. systemd loads this credential into a private,
    # read-only directory accessible only to the service user.
    service.write_text(SERVICE.replace(
        "ExecStart=/usr/local/bin/tflow-livekit-server --config /etc/tflow/livekit.yaml",
        "LoadCredential=livekit.yaml:/etc/tflow/livekit.yaml\nExecStart=/usr/local/bin/tflow-livekit-server --config %d/livekit.yaml",
    ))
    candidate = proxy.with_name("Caddyfile.video-next")
    candidate.write_text(updated_proxy)
    subprocess.run(["caddy", "validate", "--adapter", "caddyfile", "--config", str(candidate)], check=True)
    secure_write(environment, update_environment(original_env, values))
    candidate.replace(proxy)
    subprocess.run(["systemctl", "daemon-reload"], check=True)
    subprocess.run(["systemctl", "enable", "--now", "tflow-livekit"], check=True)
    subprocess.run(["systemctl", "restart", "tflow-livekit"], check=True)
    subprocess.run(["systemctl", "reload", "caddy"], check=True)
    subprocess.run(["systemctl", "restart", "tflow"], check=True)
    print(f"Configuration installed. Original files saved to {backup}. No database changes were made.")
    print("Run check_webinars using the tflow.service environment, then test host and viewer from different browsers.")


if __name__ == "__main__":
    main()
