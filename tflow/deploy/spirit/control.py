"""Manage only vm1 through the tenant's existing Spirit CI service account."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import urllib.error
import urllib.request

BASE = "https://spirit.t-education.com"
VM_ID = "162f2c6f-c180-4eca-ad4c-9f23f18ce34e"
HOST = "hack-mmk-25-vm1-162f2c.vm.prodcontest.com"
VM_PATH = f"/api/v2/tenants/hack-mmk-25/vmgroup/b9c06327-85dd-4ac8-adf6-3c5fcffb52e1/vm/{VM_ID}"
CLI_URL = f"{BASE}/static/cli/tedu/14.1.3/linux/dp"
CLI_SIZE = 22098082
CLI_SHA256 = "f740fd005d7f51723e0d85bcd7582a35dd8d24de51da522bfbbfd3dcb7333cb9"


class ControlError(Exception):
    pass


class ApiError(ControlError):
    def __init__(self, status):
        self.status = status
        super().__init__(f"Spirit API returned HTTP {status}")


def cli_binary():
    binary = Path(".spirit-cli/dp").resolve()
    if not binary.is_file() or binary.stat().st_size != CLI_SIZE:
        binary.parent.mkdir(mode=0o700, exist_ok=True)
        partial = binary.with_suffix(".part")
        print("Downloading the official Spirit CLI 14.1.3", flush=True)
        with urllib.request.urlopen(CLI_URL, timeout=30) as response, partial.open("wb") as stream:
            if not response.geturl().startswith("https://"):
                raise ControlError("CLI download must use HTTPS")
            while block := response.read(256 * 1024):
                stream.write(block)
        if partial.stat().st_size != CLI_SIZE:
            raise ControlError("Incomplete Spirit CLI download")
        partial.replace(binary)
    with binary.open("rb") as stream:
        if stream.read(4) != b"\x7fELF":
            raise ControlError("Spirit CLI is not a Linux executable")
    if hashlib.sha256(binary.read_bytes()).hexdigest() != CLI_SHA256:
        raise ControlError("Spirit CLI checksum does not match the reviewed version")
    binary.chmod(0o700)
    print("Spirit CLI 14.1.3 checksum verified", flush=True)
    return binary


def authenticate(directory):
    value = os.environ.get("SPIRIT_DOCKER_SA_KEY", "")
    if not value:
        raise ControlError("The tenant CI service-account key is unavailable")
    source = None
    if not value.lstrip().startswith("{"):
        try:
            candidate = Path(value)
            if candidate.is_file():
                source = candidate.read_text()
        except OSError:
            pass
    key = directory / "service-account.json"
    key.write_text(source if source is not None else value)
    key.chmod(0o600)
    binary = cli_binary()
    environment = {**os.environ, "DP_WORKDIR": str(directory / "dp"), "DP_NO_WARNINGS": "true"}
    # The CLI, its logs and tokens stay private; none enter job artifacts.
    auth = subprocess.run([str(binary), "auth", "service-acc", "--key-file", str(key)], env=environment, capture_output=True, text=True, timeout=90)
    if auth.returncode:
        raise ControlError("Spirit service-account authorization failed; credential output withheld")
    result = subprocess.run([str(binary), "supporting", "get-iam-token"], env=environment, capture_output=True, text=True, timeout=45)
    token = result.stdout.strip()
    if result.returncode or not token or "\n" in token:
        raise ControlError("Spirit did not issue an IAM token; credential output withheld")
    return token


class Spirit:
    def __init__(self, token):
        self.token = token

    def request(self, method, action=""):
        request = urllib.request.Request(
            BASE + VM_PATH + action, method=method,
            headers={"Authorization": "Bearer " + self.token, "Accept": "application/json"},
        )
        try:
            with urllib.request.urlopen(request, timeout=35) as response:
                body = response.read()
        except urllib.error.HTTPError as error:
            raise ApiError(error.code) from None
        except (urllib.error.URLError, TimeoutError):
            raise ControlError("Spirit API connection failed") from None
        return json.loads(body) if body else {}

    def vm(self):
        vm = self.request("GET").get("attributes", {})
        if vm.get("id") != VM_ID or vm.get("fqdn") != HOST:
            raise ControlError("The response does not identify the requested vm1")
        return vm

    def wait(self, status, seconds=240):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            vm = self.vm()
            if vm.get("status") == status:
                return vm
            time.sleep(3)
        raise ControlError(f"vm1 did not reach {status} before the deadline")

    def ensure_started(self):
        # Retry start while a preceding shutdown operation is still finishing.
        deadline = time.monotonic() + 240
        started = False
        while time.monotonic() < deadline:
            try:
                self.request("POST", "/start")
                started = True
                return self.wait("active", 180)
            except ApiError as error:
                if error.status not in {400, 409, 422, 503}:
                    raise
            except ControlError:
                pass
            vm = self.vm()
            if started and vm.get("status") == "active":
                return vm
            time.sleep(3)
        # If stop was rejected or failed, an already-running VM is safe.
        vm = self.vm()
        if vm.get("status") == "active":
            return vm
        raise ControlError("vm1 still needs a start operation; inspect Spirit immediately")


def public_state(vm):
    return {key: vm.get(key) for key in ("id", "status", "ip", "fqdn")}


def power_cycle(api):
    before = api.vm()
    if before.get("status") != "active":
        raise ControlError("Network recovery requires the existing vm1 to be active")
    print("Before:", json.dumps(public_state(before)), flush=True)
    restore = True
    try:
        try:
            api.request("POST", "/stop")
        except ApiError as error:
            if 400 <= error.status < 500:
                restore = False
            raise
        api.wait("shutoff")
        print("vm1 stopped; the existing root disk is retained", flush=True)
    finally:
        if restore:
            after = api.ensure_started()
            print("After:", json.dumps(public_state(after)), flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("inspect", "power-cycle"))
    args = parser.parse_args()
    os.umask(0o077)
    with tempfile.TemporaryDirectory(prefix="tflow-spirit-") as private:
        api = Spirit(authenticate(Path(private)))
        if args.action == "inspect":
            print(json.dumps(public_state(api.vm())), flush=True)
        else:
            power_cycle(api)


if __name__ == "__main__":
    try:
        main()
    except ControlError as error:
        raise SystemExit(str(error)) from None
