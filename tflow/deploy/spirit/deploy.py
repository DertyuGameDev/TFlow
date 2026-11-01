"""Deploy a reviewed CI artifact to the existing vm1, then require public HTTPS."""

import argparse
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import tempfile
import urllib.error
import urllib.request

from control import ControlError, HOST, Spirit, authenticate
from gateway_config import GATEWAY_HOST

# Updated after the owner-approved rebuild, using the new VM's SSH host key.
HOST_KEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILPyOFQXJ6KjzEBs0vPFIBo0Eo8pQpNoUI7davam2g3l"

REMOTE_INSTALL = r'''
import json, pathlib, subprocess, sys, time, urllib.error, urllib.request
directory = pathlib.Path(sys.argv[1])
expected = sys.argv[2]
gateway = sys.argv[3]
incoming = json.loads((directory / "manifest.json").read_text())
if incoming.get("commit") != expected:
    raise SystemExit("Incoming manifest does not identify the requested CI commit")
repo = pathlib.Path("/srv/tflow/repository")
def run(*args):
    return subprocess.run(args, check=True, capture_output=True, text=True)
if run("git", "-C", str(repo), "status", "--porcelain").stdout.strip():
    raise SystemExit("VM source checkout has local changes; refusing to overwrite them")
run("git", "-C", str(repo), "fetch", str(directory / "source.bundle"), "HEAD")
if run("git", "-C", str(repo), "rev-parse", "FETCH_HEAD").stdout.strip() != expected:
    raise SystemExit("Source bundle does not identify the requested CI commit")
run("git", "-C", str(repo), "merge", "--ff-only", expected)
if run("git", "-C", str(repo), "rev-parse", "HEAD").stdout.strip() != expected:
    raise SystemExit("A newer VM source is already present; refusing an out-of-order deployment")
gateway_changed = False
if gateway:
    gateway_changed = json.loads(run("python3", str(repo / "tflow/deploy/spirit/gateway_config.py"), gateway).stdout)["changed"]
deployed = pathlib.Path("/srv/tflow/deployed.json")
previous = json.loads(deployed.read_text()) if deployed.exists() else {}
if previous.get("commit") != expected or previous.get("sha256") != incoming.get("sha256"):
    run("python3", str(repo / "tflow/deploy/spirit/install-release.py"), str(directory / "manifest.json"), str(directory / "tflow-release.tar.gz"))
elif gateway_changed:
    run("systemctl", "restart", "tflow")
for service in ("tflow", "caddy", "postgresql"):
    run("systemctl", "is-active", "--quiet", service)
request = urllib.request.Request("http://127.0.0.1:8000/api/health", headers={"Host": "hack-mmk-25-vm1-162f2c.vm.prodcontest.com", "X-Forwarded-Proto": "https"})
for attempt in range(25):
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            if response.status != 200 or not json.load(response).get("ok"):
                raise SystemExit("Internal application healthcheck failed")
        break
    except (OSError, urllib.error.URLError):
        if attempt == 24:
            raise
        time.sleep(0.3)
sys.path.insert(0, str(repo / "tflow/deploy/spirit"))
from runtime_check import verify_runtime
verify_runtime(incoming, "hack-mmk-25-vm1-162f2c.vm.prodcontest.com")
request = urllib.request.Request("http://127.0.0.1:8000/api/broadcast-health", headers={"Host":"hack-mmk-25-vm1-162f2c.vm.prodcontest.com","X-Forwarded-Proto":"https"})
with urllib.request.urlopen(request, timeout=5) as response:
    if json.load(response) != {"enabled":True,"ready":True}:
        raise SystemExit("HTTPS broadcast service is not enabled and ready")
request = urllib.request.Request("http://127.0.0.1:8000/api/notification-health", headers={"Host":"hack-mmk-25-vm1-162f2c.vm.prodcontest.com","X-Forwarded-Proto":"https"})
with urllib.request.urlopen(request, timeout=5) as response:
    if json.load(response) != {"enabled":True,"ready":True}:
        raise SystemExit("Notification worker is not enabled and ready")
print("Exact CI source, runtime version, frontend HTML and assets verified")
'''


class PublicHttpsUnavailable(ControlError):
    """The release is installed, but the external production URL is not ready."""


def validate_release(manifest_path, archive_path, expected):
    manifest = json.loads(manifest_path.read_text())
    commit = manifest.get("commit", "")
    if not re.fullmatch(r"[0-9a-f]{40}", commit) or commit != expected:
        raise ControlError("Release must identify this exact CI commit")
    if archive_path.stat().st_size > 100 * 1024 * 1024:
        raise ControlError("Release is unexpectedly large")
    if hashlib.sha256(archive_path.read_bytes()).hexdigest() != manifest.get("sha256"):
        raise ControlError("Release checksum mismatch; no VM changes attempted")
    return commit


def command(arguments, **kwargs):
    result = subprocess.run(arguments, capture_output=True, text=True, timeout=600, **kwargs)
    if result.returncode:
        # In particular, never echo a private key or remote application environment.
        raise ControlError(f"Deployment command {Path(arguments[0]).name} failed; output withheld")
    return result


def public_checks():
    try:
        with urllib.request.urlopen(f"https://{HOST}/api/health", timeout=15) as response:
            if response.status != 200 or not json.load(response).get("ok"):
                raise ControlError("Public application healthcheck failed")
        with urllib.request.urlopen(f"https://{HOST}/register/", timeout=15) as response:
            if response.status != 200:
                raise ControlError("Public signup page is unavailable")
        try:
            with urllib.request.urlopen(f"https://{HOST}/api/profile/qr", timeout=15):
                raise ControlError("Private profile QR unexpectedly allowed anonymous access")
        except urllib.error.HTTPError as error:
            if error.code != 401:
                raise ControlError("Unexpected response from private QR endpoint") from None
    except (urllib.error.URLError, TimeoutError):
        raise PublicHttpsUnavailable(
            "The VM release is installed and internally healthy, but public HTTPS is unavailable. "
            "Inspect Spirit network access and Caddy certificate validation; production is not ready."
        ) from None


def gateway_checks():
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            return None
    from urllib.parse import urlparse
    try:
        urllib.request.build_opener(NoRedirect()).open(f"https://{GATEWAY_HOST}/", timeout=15)
    except urllib.error.HTTPError as response:
        location = urlparse(response.headers.get("Location", ""))
        if response.code in {302, 303} and location.scheme == "https" and location.hostname in {GATEWAY_HOST, "teleport.t-education.com"}:
            return
        raise ControlError("Gateway did not return the expected CU authentication redirect") from None
    except (urllib.error.URLError, TimeoutError):
        raise PublicHttpsUnavailable("Teleport gateway HTTPS is unavailable") from None
    raise ControlError("The expected CU authentication gateway is missing")


def deploy(api, private, manifest_path, archive_path, expected, gateway_mode=False):
    commit = validate_release(manifest_path, archive_path, expected)
    vm = api.vm()
    if vm.get("status") != "active":
        raise ControlError("Deploy requires the existing vm1 to be active")
    gateway = vm.get("teleportAppPublicAddr") if vm.get("teleportAppAccess") else ""
    if gateway and gateway != GATEWAY_HOST:
        raise ControlError("Unexpected Teleport gateway hostname")
    if gateway_mode and not gateway:
        raise ControlError("Enable this VM's CU gateway in Spirit before deploying")
    address = str(ipaddress.IPv4Address(vm.get("ip", "")))
    credentials = api.request("GET", "/credentials").get("attributes", {})
    if credentials.get("username") != "ubuntu" or credentials.get("host") != address:
        raise ControlError("SSH credentials do not identify the requested VM and user")
    key = credentials.get("privateKey", "")
    if not key.startswith("-----BEGIN OPENSSH PRIVATE KEY-----"):
        raise ControlError("Spirit did not return the expected SSH credential format")
    key_path = private / "ssh-key"
    key_path.write_text(key.rstrip() + "\n")
    key_path.chmod(0o600)
    hosts = private / "known_hosts"
    hosts.write_text(f"{HOST} {HOST_KEY}\n")
    hosts.chmod(0o600)
    options = ["-i", str(key_path), "-o", f"UserKnownHostsFile={hosts}",
               "-o", f"HostKeyAlias={HOST}", "-o", "StrictHostKeyChecking=yes",
               "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "-o", "ForwardAgent=no"]
    target = "ubuntu@" + address
    directory = "/home/ubuntu/tflow-ci/" + commit
    bundle = private / "source.bundle"
    command(["git", "bundle", "create", str(bundle), "HEAD"])
    actual = command(["git", "rev-parse", "HEAD"]).stdout.strip()
    if actual != commit:
        raise ControlError("Source checkout and CI artifact do not match")
    command(["ssh", *options, target, "install -d -m 700 " + directory])
    for source, name in [(manifest_path, "manifest.json"), (archive_path, "tflow-release.tar.gz"), (bundle, "source.bundle")]:
        command(["scp", *options, str(source), f"{target}:{directory}/{name}"])
    remote = shlex.join(["sudo", "-n", "python3", "-", directory, commit, gateway or ""])
    command(["ssh", *options, target, remote], input=REMOTE_INSTALL)
    print(f"Release {commit}: VM source and internal application healthcheck passed", flush=True)
    if gateway_mode:
        gateway_checks()
        print(f"Temporary CU gateway TLS and authentication redirect passed: https://{GATEWAY_HOST}", flush=True)
        print("Application requests after CU login require a signed-in browser check", flush=True)
    else:
        public_checks()
        print(f"Production HTTPS, signup and private QR checks passed: https://{HOST}", flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("manifest", type=Path)
    parser.add_argument("archive", type=Path)
    parser.add_argument("--gateway", action="store_true")
    args = parser.parse_args()
    expected = os.environ.get("CI_COMMIT_SHA", "")
    validate_release(args.manifest, args.archive, expected)
    os.umask(0o077)
    with tempfile.TemporaryDirectory(prefix="tflow-deploy-") as directory:
        private = Path(directory)
        deploy(Spirit(authenticate(private)), private, args.manifest, args.archive, expected, args.gateway)


if __name__ == "__main__":
    try:
        main()
    except ControlError as error:
        raise SystemExit(str(error)) from None
