"""Install the owned LiveKit service on vm1; DNS-01 needs no inbound ACME port."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request

HOST = "tflow-video-162f2c.duckdns.org"
ADDRESS = "158.160.209.13"
VERSION = "1.13.11"
ARCHIVE_SHA = "1e9ee90ca301e1842b2887fc77cb122759756a9c8aeb4334ee91de3325ec43fb"


def validate(values):
    if values.get("domain") != HOST or values.get("ip") != ADDRESS:
        raise ValueError("Media configuration must identify the owned vm1")
    if not re.fullmatch(r"[0-9a-fA-F-]{36}", values.get("dns_token", "")):
        raise ValueError("Missing DNS credential")
    for key in ("api_key", "api_secret"):
        if not re.fullmatch(r"[A-Za-z0-9_-]{24,128}", values.get(key, "")):
            raise ValueError("Media credentials must be random URL-safe values")
    return values


def livekit_config(values):
    # JSON is valid YAML; quoting untrusted strings never introduces YAML keys.
    return json.dumps({
        "port": 7880, "bind_addresses": ["0.0.0.0"],
        "rtc": {"tcp_port": 8081, "udp_port": 8082, "node_ip": ADDRESS, "use_external_ip": False},
        "turn": {"enabled": True, "domain": HOST, "tls_port": 8083,
                 "cert_file": "/etc/tflow-video/tls/fullchain.pem", "key_file": "/etc/tflow-video/tls/privkey.pem"},
        "keys": {values["api_key"]: values["api_secret"]},
        "room": {"max_participants": 101, "empty_timeout": 300},
        "logging": {"level": "info"},
    }, indent=2)


DNS_HOOK = r'''#!/usr/bin/python3
import json, os, subprocess, sys, time, urllib.parse, urllib.request
from pathlib import Path
values=json.loads(Path('/etc/tflow-video/dns.json').read_text())
host=values['domain']
if os.environ.get('CERTBOT_DOMAIN') != host: raise SystemExit('Unexpected ACME hostname')
clear='cleanup' in sys.argv
txt=os.environ.get('CERTBOT_VALIDATION','')
if not txt: raise SystemExit('Missing ACME validation')
params={'domains':host.removesuffix('.duckdns.org'),'token':values['dns_token'],'txt':txt}
if clear: params['clear']='true'
try:
    with urllib.request.urlopen('https://www.duckdns.org/update?'+urllib.parse.urlencode(params),timeout=20) as response:
        if not response.read().startswith(b'OK'): raise ValueError()
except Exception: raise SystemExit('DNS update failed; credential output withheld')
if not clear:
    for attempt in range(24):
        answers=[subprocess.run(['dig','+time=3','+tries=1','+short','@'+resolver,'TXT','_acme-challenge.'+host],capture_output=True,text=True).stdout for resolver in ['1.1.1.1','8.8.8.8']]
        if all(txt in answer for answer in answers): break
        time.sleep(5)
    else: raise SystemExit('ACME TXT has not propagated')
'''

RENEW_HOOK = r'''#!/usr/bin/python3
from pathlib import Path
import os, shutil, subprocess
source=Path('/etc/letsencrypt/live/tflow-video-162f2c.duckdns.org')
target=Path('/etc/tflow-video/tls')
target.mkdir(mode=0o750,exist_ok=True)
shutil.chown(target,group='tflow-video')
for name in ['fullchain.pem','privkey.pem']:
    dest=target/name
    shutil.copyfile(source/name,dest)
    os.chmod(dest,0o640)
    shutil.chown(dest,group='tflow-video')
for service in ['tflow-video','caddy']:
    if subprocess.run(['systemctl','is-active','--quiet',service]).returncode == 0:
        subprocess.run(['systemctl','restart',service],check=True)
'''

UNIT = """[Unit]
Description=TFlow owned video server
After=network-online.target
Wants=network-online.target
[Service]
User=tflow-video
Group=tflow-video
ExecStart=/usr/local/lib/tflow/livekit-server --config /etc/tflow-video/livekit.yaml
Restart=on-failure
RestartSec=3
LimitNOFILE=65536
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
[Install]
WantedBy=multi-user.target
"""


def run(*args):
    result = subprocess.run(list(map(str, args)), capture_output=True, text=True, timeout=480)
    if result.returncode:
        # Certbot and subprocess errors may contain provider URLs or credentials.
        raise RuntimeError(f"{Path(str(args[0])).name} failed; private output withheld")
    return result


def private_write(path, text, mode=0o600):
    path.parent.mkdir(mode=0o750, parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, delete=False) as stream:
        stream.write(text)
        temp = Path(stream.name)
    temp.chmod(mode)
    temp.replace(path)


def main(path):
    if os.geteuid() != 0:
        raise RuntimeError("Run as root on the owned vm1")
    values = validate(json.loads(path.read_text()))
    os.umask(0o077)
    run("apt-get", "update", "-qq")
    run("apt-get", "install", "-y", "--no-install-recommends", "certbot", "dnsutils")
    if subprocess.run(["id", "-u", "tflow-video"], capture_output=True).returncode:
        run("useradd", "--system", "--no-create-home", "--shell", "/usr/sbin/nologin", "tflow-video")
    run("usermod", "-aG", "tflow-video", "caddy")
    base = Path("/etc/tflow-video")
    base.mkdir(mode=0o750, exist_ok=True)
    shutil.chown(base, group="tflow-video")
    private_write(Path("/etc/tflow-video/dns.json"), json.dumps({"domain":HOST,"dns_token":values["dns_token"]}))
    private_write(Path("/usr/local/lib/tflow/video-dns-hook"), DNS_HOOK, 0o700)
    private_write(Path("/usr/local/lib/tflow/video-renew-hook"), RENEW_HOOK, 0o700)
    Path("/usr/local/lib/tflow").chmod(0o755)
    print("DNS-01 certificate request started", flush=True)
    run("certbot", "certonly", "--manual", "--preferred-challenges", "dns", "--manual-auth-hook", "/usr/local/lib/tflow/video-dns-hook", "--manual-cleanup-hook", "/usr/local/lib/tflow/video-dns-hook cleanup", "--deploy-hook", "/usr/local/lib/tflow/video-renew-hook", "--non-interactive", "--agree-tos", "--email", "sidovidchenko@gmail.com", "--keep-until-expiring", "-d", HOST)
    run("/usr/local/lib/tflow/video-renew-hook")
    print("Trusted DNS-01 certificate installed", flush=True)
    binary = Path("/usr/local/lib/tflow/livekit-server")
    if not binary.exists() or VERSION not in run(binary, "--version").stdout:
        url = f"https://github.com/livekit/livekit/releases/download/v{VERSION}/livekit_{VERSION}_linux_amd64.tar.gz"
        with tempfile.TemporaryDirectory(prefix="tflow-video-") as directory:
            archive = Path(directory) / "server.tar.gz"
            with urllib.request.urlopen(url, timeout=45) as response:
                content = response.read(100 * 1024 * 1024 + 1)
            if hashlib.sha256(content).hexdigest() != ARCHIVE_SHA:
                raise RuntimeError("Official LiveKit checksum mismatch")
            archive.write_bytes(content)
            with tarfile.open(archive) as bundle:
                member = next(member for member in bundle.getmembers() if member.name == "livekit-server" and member.isfile())
                binary.write_bytes(bundle.extractfile(member).read())
            binary.chmod(0o755)
    private_write(Path("/etc/tflow-video/livekit.yaml"), livekit_config(values), 0o640)
    shutil.chown("/etc/tflow-video/livekit.yaml", group="tflow-video")
    private_write(Path("/etc/systemd/system/tflow-video.service"), UNIT, 0o644)
    caddy = Path("/etc/caddy/Caddyfile")
    text = caddy.read_text()
    if HOST not in text:
        backup = Path("/var/backups/tflow") / f"before-video-caddy-{time.time_ns()}.txt"
        private_write(backup, text)
        text += f"\n# TFlow video: trusted TLS, media is DTLS over TCP 8081 / TURN TLS 8083.\nhttps://{HOST}:8080 {{\n    tls /etc/tflow-video/tls/fullchain.pem /etc/tflow-video/tls/privkey.pem\n    reverse_proxy 127.0.0.1:7880\n}}\n"
        private_write(caddy, text, 0o644)
    run("caddy", "validate", "--config", caddy)
    run("systemctl", "daemon-reload")
    run("systemctl", "enable", "--now", "tflow-video")
    if shutil.which("ufw") and "Status: active" in run("ufw", "status").stdout:
        for port in (8080, 8081, 8083):
            run("ufw", "allow", str(port)+"/tcp")
    run("systemctl", "restart", "caddy")
    run("systemctl", "enable", "--now", "certbot.timer")
    env = Path("/etc/tflow/app.env")
    original = env.read_text()
    private_write(Path("/var/backups/tflow") / f"before-video-env-{time.time_ns()}.env", original)
    updates = {"LIVEKIT_URL":f"wss://{HOST}:8080", "LIVEKIT_API_KEY":values["api_key"], "LIVEKIT_API_SECRET":values["api_secret"]}
    lines = [line for line in original.splitlines() if line.split("=",1)[0] not in updates]
    private_write(env, "\n".join([*lines,*[key+"="+value for key,value in updates.items()]])+"\n")
    run("systemctl", "restart", "tflow")
    run("systemctl", "is-active", "--quiet", "tflow", "tflow-video", "caddy")
    path.unlink()
    print(f"Owned video server {VERSION} active at https://{HOST}:8080; browser media verification remains required", flush=True)


if __name__ == "__main__":
    try:
        main(Path(sys.argv[1]))
    except Exception as error:
        raise SystemExit(str(error) if isinstance(error, (ValueError, RuntimeError)) else "Video setup failed; private output withheld") from None
