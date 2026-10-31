import io
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from control import ControlError
from video_assets import HOST, certificate_arguments, certificate_hook, prepare_assets


class VideoAssetTests(unittest.TestCase):
    def setUp(self):
        self.values = {"domain": HOST, "ip": "158.160.209.13",
                       "api_key": "test_only_key_abcdefghijklmnopqrstuvwxyz",
                       "api_secret": "test_only_secret_abcdefghijklmnopqrstuvwxyz",
                       "relay_secret": "test_only_relay_abcdefghijklmnopqrstuvwxyz"}

    def test_hook_keeps_owned_hostname_tls_validation_and_bounded_propagation_wait(self):
        hook = certificate_hook(Path("/private/test/dns.json"))
        compile(hook, "dns-hook", "exec")
        self.assertIn("/private/test/dns.json", hook)
        self.assertIn("CERTBOT_DOMAIN", hook)
        self.assertIn("time.sleep(60)", hook)
        self.assertNotIn("['dig'", hook)
        self.assertNotIn("_create_unverified_context", hook)

    def test_acme_storage_is_isolated_and_uses_the_owned_hostname(self):
        args = certificate_arguments(Path("/private/test"), Path("/private/test/dns-hook"))
        self.assertEqual(args[args.index("-d") + 1], HOST)
        self.assertEqual(args[args.index("--config-dir") + 1], "/private/test/acme-config")
        self.assertNotIn(self.values["relay_secret"], str(args))

    def test_valid_vm_assets_are_reused_without_external_downloads(self):
        calls = []
        def runner(args, stage, **kwargs):
            calls.append((args, stage))
            return SimpleNamespace(stdout=json.dumps({"configuration": self.values,
                                  "certificate_ready": True, "binary_ready": True, "services_ready": True}))
        with tempfile.TemporaryDirectory() as directory, patch("video_assets.urllib.request.urlopen") as network:
            private = Path(directory)
            requires_installation = prepare_assets(private, "/home/ubuntu/tflow-video-ci", "ubuntu@test", [], "script", runner)
            self.assertFalse(requires_installation)
            network.assert_not_called()
            config = json.loads((private / "video.json").read_text())
            self.assertTrue(config["ci_managed_certificate"])
            self.assertEqual(config["api_key"], self.values["api_key"])
            self.assertEqual((private / "video.json").stat().st_mode & 0o777, 0o600)
            self.assertEqual([stage for _, stage in calls], ["private asset state", "prepared asset configuration"])

    def test_new_certificate_is_transferred_only_through_the_pinned_ssh_options(self):
        calls = []
        with tempfile.TemporaryDirectory() as directory:
            private = Path(directory)
            def runner(args, stage, **kwargs):
                calls.append((args, stage))
                if stage == "certificate issuance":
                    certificates = private / "acme-config" / "live" / HOST
                    certificates.mkdir(parents=True)
                    for name in ("fullchain.pem", "privkey.pem"):
                        (certificates / name).write_text("test-only-certificate")
                return SimpleNamespace(stdout=json.dumps({"configuration": self.values,
                                      "certificate_ready": False, "binary_ready": True}))
            prepare_assets(private, "/home/ubuntu/tflow-video-ci", "ubuntu@test", ["-o", "StrictHostKeyChecking=yes"], "script", runner)
            transfers = [args for args, stage in calls if stage == "certificate transfer"]
            self.assertEqual(len(transfers), 1)
            self.assertIn("StrictHostKeyChecking=yes", transfers[0])
            config = json.loads((private / "video.json").read_text())
            self.assertEqual(config["certificate_directory"], "/home/ubuntu/tflow-video-ci/tls")
            self.assertEqual((private / "dns.json").stat().st_mode & 0o777, 0o600)

    def test_unverified_binary_is_never_transferred(self):
        calls = []
        def runner(args, stage, **kwargs):
            calls.append(stage)
            return SimpleNamespace(stdout=json.dumps({"configuration": self.values,
                                  "certificate_ready": True, "binary_ready": False}))
        with tempfile.TemporaryDirectory() as directory, patch("video_assets.urllib.request.urlopen", return_value=io.BytesIO(b"wrong archive")):
            with self.assertRaisesRegex(ControlError, "checksum mismatch"):
                prepare_assets(Path(directory), "/home/ubuntu/tflow-video-ci", "ubuntu@test", [], "script", runner)
        self.assertNotIn("verified binary transfer", calls)
