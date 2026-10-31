import hashlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch
import urllib.error

from control import ControlError, HOST, Spirit
from deploy import PublicHttpsUnavailable, deploy, public_checks, validate_release

COMMIT = "a" * 40


class DeploymentSafetyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.archive = self.directory / "archive.tar.gz"
        self.archive.write_bytes(b"reviewed CI artifact")
        self.manifest = self.directory / "manifest.json"
        self.manifest.write_text(json.dumps({"commit": COMMIT, "sha256": hashlib.sha256(self.archive.read_bytes()).hexdigest()}))
        self.api = Mock(spec=Spirit)
        self.api.vm.return_value = {"status": "active", "ip": "158.160.209.13"}
        self.api.request.return_value = {"attributes": {"username": "ubuntu", "host": "158.160.209.13", "privateKey": "-----BEGIN OPENSSH PRIVATE KEY-----\ntest-only\n-----END OPENSSH PRIVATE KEY-----"}}

    def test_corrupt_artifact_is_rejected_before_any_vm_access(self):
        self.archive.write_bytes(b"modified after package job")
        with self.assertRaises(ControlError):
            deploy(self.api, self.directory, self.manifest, self.archive, COMMIT)
        self.api.vm.assert_not_called()
        self.api.request.assert_not_called()

    def test_artifact_from_another_pipeline_is_rejected(self):
        with self.assertRaises(ControlError):
            validate_release(self.manifest, self.archive, "b" * 40)

    @patch("deploy.command")
    def test_credentials_for_another_host_never_reach_ssh(self, command):
        self.api.request.return_value["attributes"]["host"] = "127.0.0.1"
        with self.assertRaises(ControlError):
            deploy(self.api, self.directory, self.manifest, self.archive, COMMIT)
        command.assert_not_called()

    @patch("deploy.public_checks")
    @patch("deploy.command")
    def test_failed_ssh_is_not_retried_or_bypassed(self, command, public):
        command.side_effect = [Mock(), Mock(stdout=COMMIT), ControlError("Host key verification failed")]
        with self.assertRaises(ControlError):
            deploy(self.api, self.directory, self.manifest, self.archive, COMMIT)
        self.assertEqual(command.call_count, 3)
        self.assertIn("StrictHostKeyChecking=yes", command.call_args.args[0])
        public.assert_not_called()

    @patch("deploy.urllib.request.urlopen", side_effect=urllib.error.URLError("TLS failed"))
    def test_tls_failure_cannot_report_production_ready_or_fall_back_to_http(self, open_url):
        with self.assertRaises(PublicHttpsUnavailable):
            public_checks()
        open_url.assert_called_once_with(f"https://{HOST}/api/health", timeout=15)

    @staticmethod
    def response(body=b"", status=200):
        response = io.BytesIO(body)
        response.status = status
        return response

    @patch("deploy.urllib.request.urlopen")
    def test_public_qr_must_reject_anonymous_access(self, open_url):
        open_url.side_effect = [self.response(b'{"ok":true}'), self.response(), self.response()]
        with self.assertRaises(ControlError):
            public_checks()

    @patch("deploy.urllib.request.urlopen")
    def test_valid_https_signup_and_private_qr_pass(self, open_url):
        open_url.side_effect = [self.response(b'{"ok":true}'), self.response(), urllib.error.HTTPError(f"https://{HOST}/api/profile/qr", 401, "Unauthorized", {}, None)]
        public_checks()


if __name__ == "__main__":
    unittest.main()
