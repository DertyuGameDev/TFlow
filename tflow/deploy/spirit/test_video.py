import json
import os
import unittest
import tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from control import ControlError
from provision_video import media_command

from install_video import ADDRESS, HOST, DNS_HOOK, RENEW_HOOK, failure_reason, prepare_tls_directory, livekit_config, resolve_values, validate


class OwnedVideoConfigTests(unittest.TestCase):
    def setUp(self):
        self.values = {"domain":HOST,"ip":ADDRESS,"relay_secret":"test_only_relay_abcdefghijklmnopqrstuvwxyz",
                       "api_key":"test_only_key_abcdefghijklmnopqrstuvwxyz", "api_secret":"test_only_secret_abcdefghijklmnopqrstuvwxyz"}

    def test_other_hosts_and_config_injection_are_rejected(self):
        for changes in [{"domain":"unowned.example.test"},{"ip":"127.0.0.1"},
                        {"api_key":"key\nadmin: true"},{"api_secret":"short"},{"relay_secret":"missing"}]:
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                validate({**self.values,**changes})

    def test_tcp_and_turn_use_allowed_ports_and_advertise_vm_public_ip(self):
        config=json.loads(livekit_config(validate(self.values)))
        self.assertEqual(config["rtc"]["node_ip"],ADDRESS)
        self.assertFalse(config["rtc"]["use_external_ip"])
        self.assertEqual(config["rtc"]["tcp_port"],8081)
        self.assertEqual(config["turn"]["tls_port"],8083)
        self.assertEqual(config["turn"]["domain"],HOST)
        self.assertNotIn("127.0.0.1",config["bind_addresses"])
        self.assertNotIn("dns_token",config)

    def test_hooks_parse_as_python_and_do_not_change_a_records_during_cleanup(self):
        compile(DNS_HOOK,"dns-hook","exec")
        compile(RENEW_HOOK,"renew-hook","exec")
        self.assertIn("'txt':txt",DNS_HOOK)
        self.assertNotIn("'ip':",DNS_HOOK)
        self.assertIn("'clear':clear",DNS_HOOK)
        self.assertIn("X-TFlow-Hook-Signature",DNS_HOOK)
        self.assertNotIn("values['dns_token']",DNS_HOOK)
        self.assertIn("host=='tflow-one.vercel.app'",DNS_HOOK)
        self.assertNotIn("CERT_NONE",DNS_HOOK)

    def test_invalid_credential_names_are_reported_without_values(self):
        for key in ("api_key", "api_secret", "relay_secret"):
            with self.subTest(key=key):
                value = "private invalid credential"
                with self.assertRaises(ValueError) as error:
                    validate({**self.values, key: value})
                self.assertIn(key, str(error.exception))
                self.assertNotIn(value, str(error.exception))

    def test_routine_provision_reuses_private_vm_configuration(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            (base / "livekit.yaml").write_text(livekit_config(self.values))
            (base / "dns.json").write_text(json.dumps({"relay_secret":self.values["relay_secret"]}))
            incoming = {"domain":HOST,"ip":ADDRESS,"api_key":"","api_secret":"","relay_secret":""}
            self.assertEqual(resolve_values(incoming,base),self.values)
            self.assertEqual(incoming["api_key"],"")

    def test_initial_setup_requires_credentials_and_never_invents_them(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError,"api_key"):
                resolve_values({"domain":HOST,"ip":ADDRESS},Path(directory))

    def test_explicit_rotation_is_kept_and_partial_api_credentials_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            self.assertEqual(resolve_values(self.values,Path(directory)),self.values)
        with self.assertRaisesRegex(ValueError,"supplied together"):
            validate({**self.values,"api_secret":""},allow_missing=True)

    @patch("provision_video.subprocess.run")
    def test_ssh_and_installer_failures_have_safe_stage_diagnostics(self, run):
        for code, detail, expected in [
            (255, "Host key verification failed. private-value", "pinned SSH host key"),
            (255, "Connection timed out private-value", "SSH connection timed out"),
            (1, "certbot failed; private-value", "certbot failed"),
            (1, "certbot failed (private_value);", "certbot failed"),
            (1, "certbot failed (dns_relay_http_503); private-value", "dns_relay_http_503"),
        ]:
            with self.subTest(code=code, expected=expected):
                run.return_value = SimpleNamespace(returncode=code,stdout="private-value",stderr=detail)
                with self.assertRaises(ControlError) as error:
                    media_command(["ssh","test-only"],"installation")
                self.assertIn(expected,str(error.exception))
                self.assertIn("installation",str(error.exception))
                self.assertNotIn("private-value",str(error.exception))
                self.assertNotIn("private_value",str(error.exception))

    def test_private_installer_output_is_reduced_to_fixed_error_codes(self):
        self.assertEqual(failure_reason("private-token DNS relay HTTP 403; detail"),"dns_relay_http_403")
        self.assertEqual(failure_reason("private-token DNS relay connection failed"),"dns_relay_connection_failed")
        self.assertEqual(failure_reason("private-token"),"command_failed")

    @patch("install_video.shutil.chown")
    def test_tls_directory_remains_traversable_with_private_process_umask(self, chown):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "tls"
            previous = os.umask(0o077)
            try:
                prepare_tls_directory(target)
            finally:
                os.umask(previous)
            self.assertEqual(target.stat().st_mode & 0o777,0o750)
            chown.assert_called_once_with(target,group="tflow-video")

    @patch("install_video.shutil.chown")
    def test_reused_certificate_directory_permissions_are_repaired(self, chown):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "tls"
            target.mkdir(mode=0o700)
            prepare_tls_directory(target)
            self.assertEqual(target.stat().st_mode & 0o777,0o750)
