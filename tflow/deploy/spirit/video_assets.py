"""Prepare private video assets in CI when vm1 cannot reach external providers."""
import hashlib
import json
from pathlib import Path
import shlex
import tarfile
import urllib.request

from control import ControlError
from install_video import ARCHIVE_SHA, DNS_HOOK, HOST, VERSION


def certificate_hook(config):
    hook = DNS_HOOK.replace("/etc/tflow-video/dns.json", str(config))
    # Let the provider's TXT update propagate without requiring public DNS UDP
    # access from a Kubernetes runner. ACME checks the authoritative answer.
    return hook[:hook.index("if not clear:\n")] + "if not clear: time.sleep(60)\n"


def certificate_arguments(directory, hook):
    return ["certbot", "certonly", "--manual", "--preferred-challenges", "dns",
            "--manual-auth-hook", str(hook), "--manual-cleanup-hook", shlex.join([str(hook), "cleanup"]),
            "--non-interactive", "--agree-tos", "--email", "sidovidchenko@gmail.com",
            "--config-dir", str(directory / "acme-config"), "--work-dir", str(directory / "acme-work"),
            "--logs-dir", str(directory / "acme-logs"), "-d", HOST]


def prepare_assets(directory, remote, target, options, script, runner):
    result = runner(["ssh", *options, target, shlex.join(["sudo", "-n", "python3", "-", remote + "/video.json", "--asset-state"])],
                    "private asset state", input=script)
    state = json.loads(result.stdout)
    values = state["configuration"]
    values["ci_managed_certificate"] = True
    if not state["certificate_ready"]:
        config = directory / "dns.json"
        config.write_text(json.dumps({"domain": HOST, "relay_secret": values["relay_secret"]}))
        config.chmod(0o600)
        hook = directory / "dns-hook"
        hook.write_text(certificate_hook(config)); hook.chmod(0o700)
        runner(certificate_arguments(directory, hook), "certificate issuance")
        certificates = directory / "acme-config" / "live" / HOST
        runner(["ssh", *options, target, "install -d -m 700 " + remote + "/tls"], "certificate staging")
        runner(["scp", *options, str(certificates / "fullchain.pem"), str(certificates / "privkey.pem"), target + ":" + remote + "/tls/"],
               "certificate transfer")
        values["certificate_directory"] = remote + "/tls"
    if not state["binary_ready"]:
        archive = directory / "livekit.tar.gz"
        url = f"https://github.com/livekit/livekit/releases/download/v{VERSION}/livekit_{VERSION}_linux_amd64.tar.gz"
        try:
            with urllib.request.urlopen(url, timeout=45) as response:
                content = response.read(100 * 1024 * 1024 + 1)
        except Exception:
            raise ControlError("Official LiveKit download failed; private output withheld") from None
        if hashlib.sha256(content).hexdigest() != ARCHIVE_SHA:
            raise ControlError("Official LiveKit checksum mismatch")
        archive.write_bytes(content)
        binary = directory / "livekit-server"
        with tarfile.open(archive) as bundle:
            member = next(item for item in bundle.getmembers() if item.name == "livekit-server" and item.isfile())
            binary.write_bytes(bundle.extractfile(member).read())
        binary.chmod(0o700)
        runner(["scp", *options, str(binary), target + ":" + remote + "/livekit-server"], "verified binary transfer")
        values["binary_path"] = remote + "/livekit-server"
        values["binary_sha256"] = hashlib.sha256(binary.read_bytes()).hexdigest()
    config = directory / "video.json"
    config.write_text(json.dumps(values)); config.chmod(0o600)
    runner(["scp", *options, str(config), target + ":" + remote + "/video.json"], "prepared asset configuration")
