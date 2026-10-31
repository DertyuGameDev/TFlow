"""Inspect video ingress; optionally add one UDP rule, without restarting the VM.

Run through the tenant CI identity. Never replace a security-group template or
delete existing rules. A denied permission is an actionable infrastructure error.
"""
import argparse
import json
from pathlib import Path
import subprocess
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from control import BASE, HOST, VM_PATH, ApiError, ControlError, Spirit, authenticate
from deploy import HOST_KEY

GROUP_PATH = VM_PATH.rsplit("/vm/", 1)[0]
SG_PATH = GROUP_PATH + "/sg"
UDP_RULE = {"direction": "ingress", "protocol": "udp", "port_from": 8082,
            "port_to": 8082, "target_kind": "cidr_v4", "cidr_v4": "0.0.0.0/0",
            "description": "TFlow authenticated WebRTC media"}


def request(api, method, path, payload=None):
    req = Request(BASE + path, method=method,
                  data=json.dumps(payload).encode() if payload is not None else None,
                  headers={"Authorization": "Bearer " + api.token,
                           "Content-Type": "application/json", "Accept": "application/json"})
    try:
        with urlopen(req, timeout=25) as response:
            body = json.load(response)
    except HTTPError as error:
        raise ApiError(error.code) from None
    except (URLError, TimeoutError):
        raise ControlError("Spirit ingress request timed out; inspect state before retrying") from None
    return body.get("attributes", body)


def rules(api):
    state = request(api, "GET", SG_PATH)
    if not isinstance(state, dict) or not isinstance(state.get("rules"), list):
        raise ControlError("Spirit returned an unrecognized security-group response")
    return state["rules"]


def allows(rule, protocol, port):
    return (rule.get("direction") == "ingress"
            and rule.get("protocol") in (protocol, "any")
            and rule.get("target_kind") == "cidr_v4"
            and rule.get("cidr_v4") == "0.0.0.0/0"
            and isinstance(rule.get("port_from"), int)
            and isinstance(rule.get("port_to"), int)
            and rule["port_from"] <= port <= rule["port_to"])


def coverage(items):
    return {f"{proto}/{port}": any(allows(rule, proto, port) for rule in items)
            for proto, port in (("tcp", 443), ("tcp", 8080), ("tcp", 8081),
                                ("tcp", 8083), ("udp", 8082))}


def ensure_udp(api, before, *, timeout=120):
    if coverage(before)["udp/8082"]:
        return before
    if not all(coverage(before)[key] for key in ("tcp/443", "tcp/8080", "tcp/8081", "tcp/8083")):
        raise ControlError("Required TCP ingress is missing; no rules were changed")
    # One POST only. Never retry a potentially accepted cloud operation blindly.
    request(api, "POST", SG_PATH + "/rules",
            {"kind": "SgRuleCreatePayload", "attributes": dict(UDP_RULE)})
    deadline = time.monotonic() + timeout
    while True:
        after = rules(api)
        if not all(rule in after for rule in before):
            raise ControlError("Existing network rules changed concurrently; inspect Spirit immediately")
        if coverage(after)["udp/8082"]:
            return after
        if time.monotonic() >= deadline:
            raise ControlError("UDP rule not confirmed; inspect the operation before retrying")
        time.sleep(3)


VM_PROBE = r'''
import json, socket, ssl, subprocess, urllib.request
host='tflow-video-162f2c.duckdns.org'
request=urllib.request.Request('http://127.0.0.1:8000/api/version',headers={
 'Host':'hack-mmk-25-vm1-162f2c.vm.prodcontest.com','X-Forwarded-Proto':'https'})
with urllib.request.urlopen(request,timeout=5) as response: release=json.load(response)['id']
with socket.create_connection(('127.0.0.1',8080),timeout=5) as raw:
 with ssl.create_default_context().wrap_socket(raw,server_hostname=host): tls=True
services={name:subprocess.run(['systemctl','is-active',name],capture_output=True,text=True).stdout.strip()
 for name in ('tflow','tflow-video','caddy')}
listeners=subprocess.run(['ss','-lun'],capture_output=True,text=True).stdout
print(json.dumps({'release':release,'trusted_video_tls':tls,'services':services,'udp_8082_listening':':8082 ' in listeners}))
if not all(value=='active' for value in services.values()):raise SystemExit(1)
'''


def probe(api, private):
    data = api.request("GET", "/credentials").get("attributes", {})
    if data.get("username") != "ubuntu" or data.get("host") != "158.160.209.13":
        raise ControlError("SSH credentials do not identify the owned vm1")
    key, hosts = private / "ssh-key", private / "known_hosts"
    key.write_text(data["privateKey"].rstrip() + "\n"); key.chmod(0o600)
    hosts.write_text(HOST + " " + HOST_KEY + "\n"); hosts.chmod(0o600)
    result = subprocess.run(["ssh", "-i", str(key), "-o", "UserKnownHostsFile=" + str(hosts),
                             "-o", "HostKeyAlias=" + HOST, "-o", "StrictHostKeyChecking=yes",
                             "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "-o", "ForwardAgent=no",
                             "ubuntu@158.160.209.13", "python3 -"],
                            input=VM_PROBE, capture_output=True, text=True, timeout=40)
    if result.returncode:
        raise ControlError("Read-only VM probe failed; private SSH output withheld")
    return json.loads(result.stdout)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--allow-udp", action="store_true")
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="tflow-video-ingress-") as directory:
        private = Path(directory)
        api = Spirit(authenticate(private))
        vm = api.vm()
        if vm.get("status") != "active" or vm.get("ip") != "158.160.209.13":
            raise ControlError("Expected the existing active owned vm1")
        baseline = probe(api, private)
        print("VM before:", json.dumps(baseline), flush=True)
        try:
            before = rules(api)
            print("Spirit ingress before:", json.dumps(coverage(before)), flush=True)
            after = ensure_udp(api, before) if args.allow_udp else before
            print("Spirit ingress after:", json.dumps(coverage(after)), flush=True)
        except ApiError as error:
            if error.status in (401, 403):
                raise ControlError("Spirit denies network-rule access to the tenant CI identity; an infrastructure administrator must allow UDP 8082. VM, disk and existing rules were retained") from None
            raise
        finally:
            final = probe(api, private)
            print("VM after:", json.dumps(final), flush=True)
            if final != baseline:
                raise ControlError("Application or video state changed during the network check; inspect before continuing")


if __name__ == "__main__":
    try:
        main()
    except (ControlError, subprocess.TimeoutExpired) as error:
        raise SystemExit(str(error) if isinstance(error, ControlError) else "VM probe timed out; no service restart was requested") from None
