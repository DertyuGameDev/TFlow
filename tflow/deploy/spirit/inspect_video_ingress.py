"""Read-only guest firewall/routing diagnostics for the owned vm1."""
import inspect
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import tempfile

from control import HOST, ControlError, Spirit, authenticate
from deploy import HOST_KEY
from install_video import ADDRESS


def redact_network_output(value):
    value = re.sub(r'/\*.*?\*/|(?:--)?comment\s+"[^"]*"', '[comment withheld]', value, flags=re.S)
    value = re.sub(r'\b(?:\d{1,3}\.){3}\d{1,3}\b',
        lambda match: match[0] if match[0] in {'0.0.0.0', '127.0.0.1', '158.160.209.13'} or match[0].startswith('10.130.0.') else '[address withheld]', value)
    value = re.sub(r'(?<![A-Za-z0-9])(?:[0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}(?![A-Za-z0-9])', lambda match: match[0] if match[0] in {'::', '::1'} else '[IPv6 withheld]', value)
    value = re.sub(r'[A-Za-z0-9+/=_-]{32,}', '[blob withheld]', value)
    return value


def capture_duration(value):
    try:
        duration = int(value or '0')
    except ValueError:
        raise ControlError('Capture duration must be an integer from 0 to 90 seconds') from None
    if not 0 <= duration <= 90:
        raise ControlError('Capture duration must be an integer from 0 to 90 seconds')
    return duration


SCRIPT = 'import json,re,selectors,shutil,socket,subprocess,sys,time\n' + inspect.getsource(redact_network_output) + r'''
def read_command(arguments):
    if not shutil.which(arguments[0]): return {"available":False}
    try:
        result=subprocess.run(arguments,capture_output=True,text=True,timeout=8)
        return {"available":True,"exit_status":result.returncode,"output":redact_network_output(result.stdout)[:12000]}
    except subprocess.TimeoutExpired: return {"available":True,"timeout":True}
commands={
    "addresses":["ip","-j","address","show"],
    "routes":["ip","-j","route","show","table","main"],
    "routing_rules":["ip","-j","rule","show"],
    "iptables":["iptables","-S"],
    "nftables":["nft","list","ruleset"],
    "fail2ban":["fail2ban-client","status"],
    "reverse_path_filter":["sysctl","net.ipv4.conf.all.rp_filter","net.ipv4.conf.default.rp_filter"],
}
report={name:read_command(arguments) for name,arguments in commands.items()}
jails=re.search(r"Jail list:\s*([^\n]+)",report["fail2ban"].get("output",""))
if jails:
    report["jails"]={name.strip():read_command(["fail2ban-client","status",name.strip()]) for name in jails[1].split(",") if re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,47}",name.strip())}
report["capture_available"]=bool(shutil.which("tcpdump"))
print(json.dumps({"ingress":report}),flush=True)
seconds=int(sys.argv[1])
if seconds and report["capture_available"]:
    # SYN headers only on the existing video listener; no payloads or addresses
    # are persisted or returned. Only aggregate counts and controlled ports.
    process=subprocess.Popen(["tcpdump","-i","any","-nn","-l","-Q","in","tcp dst port 8080 and tcp[tcpflags] & tcp-syn != 0"],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True)
    selector=selectors.DefaultSelector(); selector.register(process.stdout,selectors.EVENT_READ)
    counts={"syn_packets":0,"controlled_source_ports":{}}
    deadline=time.monotonic()+seconds
    print("VIDEO_INGRESS_CAPTURE_READY",flush=True)
    try:
        while time.monotonic()<deadline and process.poll() is None:
            for key,_ in selector.select(timeout=0.5):
                line=key.fileobj.readline()
                if not line: break
                if "Flags [S" not in line: continue
                counts["syn_packets"]+=1
                match=re.search(r" IP [0-9.]+\.([0-9]+) >",line)
                if match and 60070<=int(match[1])<=60079:
                    port=match[1];counts["controlled_source_ports"][port]=counts["controlled_source_ports"].get(port,0)+1
    finally:
        selector.close();process.terminate()
        try: process.wait(timeout=3)
        except subprocess.TimeoutExpired: process.kill();process.wait()
    print(json.dumps({"capture":counts}),flush=True)
'''


def ssh_options(api, directory):
    vm = api.vm()
    if vm.get('status') != 'active' or vm.get('ip') != ADDRESS:
        raise ControlError('Ingress diagnostics require the owned active vm1')
    values = api.request('GET', '/credentials').get('attributes', {})
    if values.get('username') != 'ubuntu' or values.get('host') != ADDRESS:
        raise ControlError('SSH credentials identify a different machine')
    key = directory / 'ssh-key'
    key.write_text(values['privateKey'].rstrip() + '\n'); key.chmod(0o600)
    hosts = directory / 'known_hosts'
    hosts.write_text(f'{HOST} {HOST_KEY}\n'); hosts.chmod(0o600)
    return ['-i',str(key),'-o',f'UserKnownHostsFile={hosts}','-o',f'HostKeyAlias={HOST}',
            '-o','StrictHostKeyChecking=yes','-o','BatchMode=yes','-o','ConnectTimeout=10','-o','ForwardAgent=no','-o','ServerAliveInterval=5','-o','ServerAliveCountMax=3']


def main():
    seconds = capture_duration(os.environ.get('TFLOW_VIDEO_CAPTURE_SECONDS'))
    os.umask(0o077)
    with tempfile.TemporaryDirectory(prefix='tflow-video-ingress-') as name:
        directory = Path(name)
        api = Spirit(authenticate(directory))
        options = ssh_options(api, directory)
        command = ['ssh',*options,'ubuntu@'+ADDRESS,shlex.join(['sudo','-n','python3','-',str(seconds)])]
        process = subprocess.Popen(command,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        try:
            process.stdin.write(SCRIPT); process.stdin.close()
            for line in process.stdout:
                if line.strip() == 'VIDEO_INGRESS_CAPTURE_READY' or line.startswith(('{"ingress":','{"capture":')):
                    print(line.strip(),flush=True)
            if process.wait(timeout=seconds+120):
                raise ControlError('VM ingress diagnostics failed; private SSH output withheld')
        finally:
            if process.poll() is None:
                process.terminate()
                try: process.wait(timeout=5)
                except subprocess.TimeoutExpired: process.kill();process.wait()


if __name__ == '__main__':
    try:
        main()
    except ControlError as error:
        raise SystemExit(str(error)) from None
