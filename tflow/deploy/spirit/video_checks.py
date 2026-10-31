"""Verify the browser-facing transport without logging keys or room contents."""
import base64
import hashlib
import hmac
import json
import socket
import ssl
import time
from urllib.request import Request, urlopen

from control import ControlError
from install_video import ADDRESS, HOST

VM_CHECK = r'''
import json,re,socket,ssl,subprocess
host="tflow-video-162f2c.duckdns.org"
ports={}
for port in (7880,8080,8081,8083):
    try:
        with socket.create_connection(("127.0.0.1",port),timeout=3): ports[str(port)]=True
    except OSError: ports[str(port)]=False
try:
    with socket.create_connection(("127.0.0.1",8080),timeout=5) as raw:
        with ssl.create_default_context().wrap_socket(raw,server_hostname=host): tls=True
except Exception: tls=False
result=subprocess.run(["sudo","-n","ufw","status"],capture_output=True,text=True)
rules=[line.strip() for line in result.stdout.splitlines() if any(str(port)+"/tcp" in line for port in (8080,8081,8083))]
states={}; logs={}
for service in ("tflow-video","caddy"):
    states[service]=subprocess.run(["systemctl","show",service,"--property=ActiveState,SubState,Result,ExecMainStatus,NRestarts"],capture_output=True,text=True).stdout.splitlines()
    raw=subprocess.run(["journalctl","-u",service,"-n","8","--no-pager","-o","cat"],capture_output=True,text=True).stdout
    # Withhold token/key-like blobs before truncating or emitting log lines.
    raw=re.sub(r"[A-Za-z0-9+/=_-]{32,}","[redacted]",raw)
    logs[service]=[line[:600] for line in raw.splitlines()]
memory={}
for line in open("/proc/meminfo"):
    name,value=line.split(":",1)
    if name in ("MemTotal","MemAvailable","SwapTotal","SwapFree"):memory[name]=value.strip()
print(json.dumps({"local_listeners":ports,"local_trusted_tls":tls,"media_firewall_rules":rules,"service_state":states,"service_logs":logs,"memory":memory}))
'''


def network_metadata(vm):
    allowed = {"id", "name", "kind", "resourceKind", "identifier", "attributes",
               "port", "ports", "protocol", "source", "sourceCidr", "sourceCIDR",
               "direction", "fromPort", "toPort", "cidr", "ip", "rules", "description"}
    def scrub(value):
        if isinstance(value, dict):
            return {key: scrub(item) for key, item in value.items() if key in allowed}
        if isinstance(value, list):
            return [scrub(item) for item in value[:30]]
        if isinstance(value, (str, int, bool)):
            return value if not isinstance(value, str) or len(value) <= 160 else "withheld"
        return None
    public_fields = {"network", "networks", "networkRules", "networkRulesTemplate",
                     "networkRulesId", "networkRule", "networkRuleTemplate", "networkSettings",
                     "securityGroups", "firewall", "firewallRules", "networkRulesTemplateId"}
    names = sorted(key for key in vm if any(word in key.lower() for word in ("network", "firewall", "securitygroup")))
    return {"field_names": names, "configuration": {key: scrub(value) for key, value in vm.items() if key in public_fields}}


def list_rooms_token(values):
    def encode(value):
        return base64.urlsafe_b64encode(value).rstrip(b"=")
    now = int(time.time())
    body = {"iss": values["api_key"], "sub": "tflow-transport-check",
            "nbf": now - 5, "exp": now + 60, "video": {"roomList": True}}
    unsigned = encode(b'{"alg":"HS256","typ":"JWT"}') + b"." + encode(json.dumps(body).encode())
    return (unsigned + b"." + encode(hmac.new(values["api_secret"].encode(), unsigned, hashlib.sha256).digest())).decode()


def verify_public(values):
    origin = "https://" + HOST + ":8080"
    try:
        with urlopen(origin, timeout=10) as response:
            if response.status != 200:
                raise ValueError()
        request = Request(origin + "/twirp/livekit.RoomService/ListRooms", data=b"{}",
                          headers={"Content-Type": "application/json", "Authorization": "Bearer " + list_rooms_token(values)})
        with urlopen(request, timeout=10) as response:
            if response.status != 200:
                raise ValueError()
            json.load(response)
        with socket.create_connection((ADDRESS, 8081), timeout=5):
            pass
        with socket.create_connection((ADDRESS, 8083), timeout=5) as raw:
            with ssl.create_default_context().wrap_socket(raw, server_hostname=HOST):
                pass
    except Exception:
        raise ControlError("Browser-facing video transport check failed; inspect Spirit ingress and the safe VM network diagnostics") from None
    print("Public video HTTPS, API authentication, media TCP and TURN TLS checks passed", flush=True)
