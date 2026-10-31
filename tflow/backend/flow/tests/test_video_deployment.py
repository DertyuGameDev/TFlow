"""Validate VM configuration generation without installing software or services."""
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
import runpy
from unittest.mock import patch

from django.test import SimpleTestCase


class VideoDeploymentTests(SimpleTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.script = runpy.run_path(str(Path(__file__).resolve().parents[3] / "deploy/spirit/configure-video.py"))

    def test_proxy_keeps_tls_and_routes_media_separately(self):
        original = "# Managed by TFlow\nevents.example.test {\n    tls {\n        issuer acme\n    }\n    encode zstd gzip\n    reverse_proxy 127.0.0.1:8000\n}\n"
        output = self.script["proxy_config"](original)
        self.assertIn("handle_path /livekit/*", output)
        self.assertIn("reverse_proxy 127.0.0.1:7880", output)
        self.assertIn("handle {\n        reverse_proxy 127.0.0.1:8000", output)
        self.assertIn("tls {\n        issuer acme", output)
        self.assertEqual(self.script["proxy_config"](output), output)
        with self.assertRaises(ValueError):
            self.script["proxy_config"]("custom.example.test { reverse_proxy localhost:9000 }")

    def test_environment_preserves_database_and_replaces_video_once(self):
        source = "# Keep unrelated configuration\nDATABASE_URL=postgresql://example\nLIVEKIT_URL=old\nLIVEKIT_URL=duplicate\nDJANGO_DEBUG=0\n"
        output = self.script["update_environment"](source, {"LIVEKIT_URL": "wss://events.example.test/livekit", "LIVEKIT_API_URL": "http://127.0.0.1:7880"})
        self.assertIn("DATABASE_URL=postgresql://example\n", output)
        self.assertIn("DJANGO_DEBUG=0\n", output)
        self.assertEqual(output.count("LIVEKIT_URL="), 1)
        self.assertEqual(self.script["update_environment"](output, {"LIVEKIT_URL": "wss://events.example.test/livekit", "LIVEKIT_API_URL": "http://127.0.0.1:7880"}), output)

    def test_media_advertises_public_ip_but_admin_api_stays_on_loopback(self):
        output = self.script["video_config"]("158.160.209.13", "test-key", "test-secret")
        self.assertIn("bind_addresses: [127.0.0.1]", output)
        self.assertIn("node_ip: 158.160.209.13", output)
        self.assertIn("tcp_port: 8001", output)
        self.assertIn("udp_port: 8002", output)
        self.assertIn("use_external_ip: false", output)
        self.assertNotIn("devkey", output)

    def test_default_command_does_not_apply_configuration(self):
        output = StringIO()
        with patch("sys.argv", ["configure-video.py", "--hostname", "events.example.test", "--public-ip", "158.160.209.13"]), redirect_stdout(output):
            self.script["main"]()
        self.assertIn("Dry run", output.getvalue())


class GitLabVideoDeployTests(SimpleTestCase):
    def test_pipeline_identity_is_checked_before_ssh_and_secrets_are_file_only(self):
        import hashlib
        import json
        import os
        import tempfile
        script = runpy.run_path(str(Path(__file__).resolve().parents[3] / "deploy/spirit/deploy-ci.py"))
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            fake_file = root / "tflow/deploy/spirit/deploy-ci.py"
            fake_file.parent.mkdir(parents=True)
            release = root / "release"
            release.mkdir()
            archive = release / "tflow-release.tar.gz"
            archive.write_bytes(b"test-ci-artifact")
            sha = "a" * 40
            manifest = release / "manifest.json"
            manifest.write_text(json.dumps({"commit": sha, "sha256": hashlib.sha256(archive.read_bytes()).hexdigest()}))
            key = root / "key"
            hosts = root / "hosts"
            key.write_text("private-test-material")
            hosts.write_text("test-known-host")
            script["main"].__globals__["__file__"] = str(fake_file)
            environment = {
                "CI_COMMIT_SHA": "b" * 40,
                "TFLOW_VM_SSH_KEY": str(key),
                "TFLOW_VM_KNOWN_HOSTS": str(hosts),
                "TFLOW_VM_HOST": "158.160.209.13",
                "TFLOW_CONFIGURE_VIDEO": "1",
            }
            with patch.dict(os.environ, environment), patch("subprocess.run") as run:
                with self.assertRaisesMessage(SystemExit, "does not match"):
                    script["main"]()
                run.assert_not_called()
                os.environ["CI_COMMIT_SHA"] = sha
                with redirect_stdout(StringIO()):
                    script["main"]()
                commands = [call.args[0] for call in run.call_args_list]
                flattened = " ".join(str(arg) for command in commands for arg in command)
                self.assertIn("StrictHostKeyChecking=yes", flattened)
                self.assertIn("install-release.py", flattened)
                self.assertIn("configure-video.py", flattened)
                self.assertIn("check_webinars", flattened)
                self.assertNotIn("private-test-material", flattened)
