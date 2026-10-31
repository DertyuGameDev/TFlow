"""Run the media installer from the tenant's CI network with a pinned SSH key."""
import json
import os
from pathlib import Path
import shlex
import sys
import tempfile

from control import ControlError, HOST, Spirit, authenticate
from deploy import HOST_KEY, command
from install_video import ADDRESS, HOST as VIDEO_HOST, validate

REMOTE_INSPECT = r'''
from pathlib import Path
import email.utils, hashlib, hmac, json, socket, subprocess, time, urllib.error, urllib.request
values={}
text=Path('/var/log/tflow-video-setup.log').read_text(errors='replace') if Path('/var/log/tflow-video-setup.log').exists() else ''
for name in ['/etc/tflow-video/dns.json','/home/ubuntu/tflow-video-ci/video.json']:
    if Path(name).exists():
        data=json.loads(Path(name).read_text())
        values.update(data)
        for key,value in data.items():
            if key.endswith(('secret','token')) or key=='api_key': text=text.replace(value,'[redacted]')
report={'vm_time':int(time.time()),'certificate':Path('/etc/letsencrypt/live/tflow-video-162f2c.duckdns.org/fullchain.pem').exists(),
        'services':subprocess.run(['systemctl','is-active','tflow','tflow-video','caddy'],capture_output=True,text=True).stdout.splitlines()}
secret=values.get('relay_secret')
if secret:
    report['relay_fingerprint']=hashlib.sha256(secret.encode()).hexdigest()[:12]
    # A deliberately invalid TXT proves authentication without changing DNS.
    payload=json.dumps({'txt':'invalid','clear':False,'timestamp':int(time.time())},separators=(',',':')).encode()
    signature=hmac.new(secret.encode(),payload,hashlib.sha256).hexdigest()
    original=socket.getaddrinfo
    socket.getaddrinfo=lambda host,port,*args,**kwargs:original('76.76.21.21' if host=='tflow-one.vercel.app' else host,port,*args,**kwargs)
    request=urllib.request.Request('https://tflow-one.vercel.app/api/internal/dns-challenge',data=payload,headers={'Content-Type':'application/json','X-TFlow-Hook-Signature':signature})
    try:
        with urllib.request.urlopen(request,timeout=8) as response:report['relay_probe_status']=response.status
    except urllib.error.HTTPError as error:
        report['relay_probe_status']=error.code
        if error.headers.get('Date'):
            report['clock_delta_seconds']=round(time.time()-email.utils.parsedate_to_datetime(error.headers['Date']).timestamp())
    except Exception as error:report['relay_probe_error']=type(error).__name__
print(json.dumps(report))
print('PRIVATE LOG, CREDENTIAL VALUES REDACTED:\n'+text[-4000:])
'''


def main():
    inspect = sys.argv[1:] == ["--inspect"]
    if sys.argv[1:] and not inspect:
        raise ControlError("Only --inspect is supported")
    values = None if inspect else validate({"domain": VIDEO_HOST, "ip": ADDRESS,
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
        options = ["-i",str(key),"-o",f"UserKnownHostsFile={hosts}","-o",f"HostKeyAlias={HOST}","-o","StrictHostKeyChecking=yes","-o","BatchMode=yes","-o","ConnectTimeout=10","-o","ForwardAgent=no"]
        target = "ubuntu@"+ADDRESS
        inspect_command = ["ssh",*options,target,"sudo -n python3 -"]
        if inspect:
            print(command(inspect_command,input=REMOTE_INSPECT).stdout)
            return
        config = private / "video.json"
        config.write_text(json.dumps(values)); config.chmod(0o600)
        remote = "/home/ubuntu/tflow-video-ci"
        command(["ssh",*options,target,"install -d -m 700 "+remote])
        command(["scp",*options,str(config),f"{target}:{remote}/video.json"])
        script = Path(__file__).with_name("install_video.py").read_text()
        try:
            result = command(["ssh",*options,target,shlex.join(["sudo","-n","python3","-",remote+"/video.json"])],input=script)
        except ControlError:
            try:
                print(command(inspect_command,input=REMOTE_INSPECT).stdout,flush=True)
            except ControlError:
                print("VM diagnostics unavailable; credential output withheld",flush=True)
            raise
        print(result.stdout)


if __name__ == "__main__":
    try:
        main()
    except (ControlError, ValueError) as error:
        raise SystemExit(str(error)) from None
