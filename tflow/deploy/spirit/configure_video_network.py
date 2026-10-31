"""Allow only the media UDP port already configured on the owned Spirit vm1."""
import json
from pathlib import Path
import tempfile
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from check_video_network_policy import inspect_security_group
from control import BASE, VM_PATH, ControlError, Spirit, authenticate
from install_video import ADDRESS

MEDIA_PORT = 8082


def media_udp_allowed(policy):
    for rule in policy["rules"]:
        if (rule.get("direction") != "ingress" or rule.get("protocol") not in {"udp", "any"}
                or rule.get("cidr_v4") != "0.0.0.0/0"):
            continue
        lower, upper = rule.get("port_from"), rule.get("port_to")
        if lower is None and upper is None:
            return True
        if isinstance(lower, int) and isinstance(upper, int) and lower <= MEDIA_PORT <= upper:
            return True
    return False


def configure(api):
    vm = api.vm()
    if vm.get("status") != "active" or vm.get("ip") != ADDRESS:
        raise ControlError("Media network setup requires the owned active vm1")
    if media_udp_allowed(inspect_security_group(api)):
        return {"udp_port": MEDIA_PORT, "changed": False}
    payload = {"direction": "ingress", "protocol": "udp", "port_from": MEDIA_PORT,
               "port_to": MEDIA_PORT, "target_kind": "cidr_v4", "cidr_v4": "0.0.0.0/0",
               "description": "TFlow LiveKit media"}
    path = VM_PATH.rsplit("/vm/", 1)[0] + "/sg/rules"
    request = Request(BASE + path, method="POST", data=json.dumps({"kind": "SgRuleCreatePayload", "attributes": payload}).encode(),
                      headers={"Authorization": "Bearer " + api.token, "Content-Type": "application/json"})
    try:
        # Submit once only. A lost response must not create duplicate rules.
        with urlopen(request, timeout=30) as response:
            response.read()
    except HTTPError as error:
        raise ControlError("Media network setup returned HTTP " + str(error.code)) from None
    for _ in range(20):
        if media_udp_allowed(inspect_security_group(api)):
            return {"udp_port": MEDIA_PORT, "changed": True}
        time.sleep(3)
    raise ControlError("Media UDP rule was submitted but is not yet visible in Spirit")


if __name__ == "__main__":
    with tempfile.TemporaryDirectory(prefix="tflow-media-network-") as directory:
        try:
            print(json.dumps(configure(Spirit(authenticate(Path(directory))))))
        except ControlError as error:
            raise SystemExit(str(error)) from None
