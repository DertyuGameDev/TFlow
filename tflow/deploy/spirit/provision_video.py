"""Run the media installer from the tenant's CI network with a pinned SSH key."""
import json
import os
from pathlib import Path
import shlex
import tempfile

from control import ControlError, HOST, Spirit, authenticate
from deploy import HOST_KEY, command
from install_video import ADDRESS, HOST as VIDEO_HOST, validate


def main():
    values = validate({"domain": VIDEO_HOST, "ip": ADDRESS,
        "relay_secret": os.environ.get("TFLOW_DNS_HOOK_SECRET", ""),
        "api_key": os.environ.get("TFLOW_VIDEO_KEY", ""),
        "api_secret": os.environ.get("TFLOW_VIDEO_SECRET", "")})
    os.umask(0o077)
    with tempfile.TemporaryDirectory(prefix="tflow-video-ci-") as directory:
        private = Path(directory)
        api = Spirit(authenticate(private))
        vm = api.vm()
        if vm.get("status") != "active" or vm.get("ip") != ADDRESS:
            raise ControlError("Video setup requires the owned active vm1")
        credentials = api.request("GET", "/credentials").get("attributes", {})
        if credentials.get("username") != "ubuntu" or credentials.get("host") != ADDRESS:
            raise ControlError("Media SSH credentials identify a different machine")
        key = private / "ssh-key"
        key.write_text(credentials["privateKey"].rstrip()+"\n"); key.chmod(0o600)
        hosts = private / "known_hosts"
        hosts.write_text(f"{HOST} {HOST_KEY}\n"); hosts.chmod(0o600)
        config = private / "video.json"
        config.write_text(json.dumps(values)); config.chmod(0o600)
        options = ["-i",str(key),"-o",f"UserKnownHostsFile={hosts}","-o",f"HostKeyAlias={HOST}","-o","StrictHostKeyChecking=yes","-o","BatchMode=yes","-o","ConnectTimeout=10","-o","ForwardAgent=no"]
        target = "ubuntu@"+ADDRESS
        remote = "/home/ubuntu/tflow-video-ci"
        command(["ssh",*options,target,"install -d -m 700 "+remote])
        command(["scp",*options,str(config),f"{target}:{remote}/video.json"])
        script = Path(__file__).with_name("install_video.py").read_text()
        result = command(["ssh",*options,target,shlex.join(["sudo","-n","python3","-",remote+"/video.json"])],input=script)
        print(result.stdout)


if __name__ == "__main__":
    try:
        main()
    except (ControlError, ValueError) as error:
        raise SystemExit(str(error)) from None
