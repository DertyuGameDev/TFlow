"""Run the media installer from the tenant's CI network with a pinned SSH key."""
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import tempfile

from control import ControlError, HOST, Spirit, authenticate
from deploy import HOST_KEY
from install_video import ADDRESS, HOST as VIDEO_HOST, failure_reason, validate
from video_assets import prepare_assets


def media_command(arguments, stage, **kwargs):
    try:
        result = subprocess.run(arguments, capture_output=True, text=True, timeout=600, **kwargs)
    except subprocess.TimeoutExpired:
        raise ControlError(f"Media setup {stage} timed out; private output withheld") from None
    if result.returncode:
        reason = "remote command failed"
        if result.returncode == 255:
            reason = "SSH transport or authentication failed"
            if "Host key verification failed" in result.stderr or "REMOTE HOST IDENTIFICATION HAS CHANGED" in result.stderr:
                reason = "pinned SSH host key verification failed"
            elif "Permission denied" in result.stderr:
                reason = "SSH authentication denied"
            elif "timed out" in result.stderr:
                reason = "SSH connection timed out"
        elif Path(str(arguments[0])).name == "certbot":
            reason = "certificate request " + failure_reason(result.stdout + result.stderr)
        else:
            # Classify known installer errors; never echo remote stdout/stderr.
            for command in ("certbot", "apt-get", "caddy", "systemctl"):
                if command + " failed" in result.stderr:
                    match = re.search(re.escape(command) + r" failed \((dns_relay_http_[1-5][0-9]{2}|dns_relay_connection_failed|dns_txt_not_propagated|upstream_connection_failed|acme_validation_failed|command_failed)\);", result.stderr)
                    category = " (" + match[1] + ")" if match else ""
                    reason = command + " failed" + category + "; inspect private /var/log/tflow-video-setup.log on vm1"
                    break
        raise ControlError(f"Media setup {stage} failed: {reason}; private output withheld")
    print(f"Media setup {stage} passed", flush=True)
    return result


def main():
    values = validate({"domain": VIDEO_HOST, "ip": ADDRESS,
        "relay_secret": os.environ.get("TFLOW_DNS_HOOK_SECRET", ""),
        "api_key": os.environ.get("TFLOW_VIDEO_KEY", ""),
        "api_secret": os.environ.get("TFLOW_VIDEO_SECRET", "")}, allow_missing=True)
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
        media_command(["ssh",*options,target,"install -d -m 700 "+remote], "SSH connection")
        media_command(["scp",*options,str(config),f"{target}:{remote}/video.json"], "configuration transfer")
        script = Path(__file__).with_name("install_video.py").read_text()
        prepare_assets(private, remote, target, options, script, media_command)
        result = media_command(["ssh",*options,target,shlex.join(["sudo","-n","python3","-",remote+"/video.json"])], "installation", input=script)
        print(result.stdout)


if __name__ == "__main__":
    try:
        main()
    except (ControlError, ValueError) as error:
        raise SystemExit(str(error)) from None
