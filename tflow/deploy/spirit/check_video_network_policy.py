"""Read the network policy attached to the group containing the owned vm1."""
import json
from pathlib import Path
import tempfile
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from control import BASE, VM_PATH, ControlError, Spirit, authenticate
from video_checks import network_metadata


def inspect_policy(api):
    api.vm()  # Validate that the tenant identity still identifies the owned VM.
    path = VM_PATH.rsplit("/vm/", 1)[0]
    request = Request(BASE + path, headers={"Authorization": "Bearer " + api.token, "Accept": "application/json"})
    try:
        with urlopen(request, timeout=20) as response:
            attributes = json.load(response).get("attributes", {})
    except HTTPError as error:
        raise ControlError("VM group policy returned HTTP " + str(error.code)) from None
    if attributes.get("id") and attributes["id"] != path.rsplit("/", 1)[1]:
        raise ControlError("Network policy response identifies a different VM group")
    return {"group_attribute_names": sorted(attributes), "network": network_metadata(attributes)}


def inspect_security_group(api):
    """Read actual cloud firewall rules, rather than group display metadata."""
    api.vm()
    path = VM_PATH.rsplit("/vm/", 1)[0] + "/sg"
    request = Request(BASE + path, headers={"Authorization": "Bearer " + api.token, "Accept": "application/json"})
    try:
        with urlopen(request, timeout=20) as response:
            attributes = json.load(response).get("attributes", {})
    except HTTPError as error:
        raise ControlError("VM security group returned HTTP " + str(error.code)) from None
    rules = []
    for rule in attributes.get("rules", []):
        rules.append({
            key: rule[key] for key in ("direction", "protocol", "port_from", "port_to", "target_kind", "cidr_v4", "origin")
            if key in rule
        })
        if rules[-1].get("cidr_v4") not in (None, "0.0.0.0/0"):
            rules[-1]["cidr_v4"] = "[address withheld]"
    return {"rules": rules, "last_applied_at": attributes.get("lastAppliedAt")}


if __name__ == "__main__":
    with tempfile.TemporaryDirectory(prefix="tflow-network-policy-") as directory:
        try:
            print(json.dumps(inspect_policy(Spirit(authenticate(Path(directory))))))
        except ControlError as error:
            raise SystemExit(str(error)) from None
