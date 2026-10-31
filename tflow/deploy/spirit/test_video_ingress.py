import io
import json
import unittest
import tempfile
from pathlib import Path
from unittest.mock import Mock, patch

from control import ApiError, ControlError
import video_ingress as ingress


class VideoIngressTests(unittest.TestCase):
    def setUp(self):
        self.before = [{**ingress.UDP_RULE, "id": "tcp", "protocol": "tcp", "port_from": 8000,
                        "port_to": 8100},
                       {**ingress.UDP_RULE, "id": "https", "protocol": "tcp", "port_from": 443,
                        "port_to": 443}]
        self.after = self.before + [{**ingress.UDP_RULE, "id": "media"}]

    @patch("video_ingress.urlopen")
    def test_reads_actual_security_group_endpoint_and_hides_private_fields(self, upstream):
        upstream.return_value = io.BytesIO(json.dumps({"attributes": {"rules": self.before}}).encode())
        api = Mock(token="private-credential")
        self.assertEqual(ingress.rules(api), self.before)
        req = upstream.call_args.args[0]
        self.assertTrue(req.full_url.endswith("/sg"))
        self.assertNotIn("private-credential", json.dumps(ingress.coverage(self.before)))
        self.assertFalse(ingress.coverage(self.before)["udp/8082"])

    @patch("video_ingress.rules")
    @patch("video_ingress.request")
    def test_adds_only_single_udp_rule_and_preserves_existing_rules(self, request, rules):
        rules.return_value = self.after
        self.assertEqual(ingress.ensure_udp(Mock(), self.before), self.after)
        args = request.call_args.args
        self.assertEqual(args[1:3], ("POST", ingress.SG_PATH + "/rules"))
        self.assertEqual(args[3], {"kind": "SgRuleCreatePayload", "attributes": ingress.UDP_RULE})
        request.assert_called_once()

    @patch("video_ingress.request")
    def test_existing_udp_is_noop(self, request):
        self.assertEqual(ingress.ensure_udp(Mock(), self.after), self.after)
        request.assert_not_called()

    @patch("video_ingress.request")
    def test_denied_permission_propagates_without_retry_or_template_reset(self, request):
        request.side_effect = ApiError(403)
        with self.assertRaises(ApiError): ingress.ensure_udp(Mock(), self.before)
        request.assert_called_once()

    @patch("video_ingress.request")
    def test_no_broad_tcp_repair(self, request):
        with self.assertRaisesRegex(ControlError, "no rules were changed"):
            ingress.ensure_udp(Mock(), self.before[:1])
        request.assert_not_called()

    @patch("video_ingress.rules")
    @patch("video_ingress.request")
    def test_detects_concurrent_deletion_and_never_replaces_template(self, request, rules):
        rules.return_value = self.after[1:]
        with self.assertRaisesRegex(ControlError, "concurrently"):
            ingress.ensure_udp(Mock(), self.before)
        request.assert_called_once()

    def test_restricted_source_does_not_look_public_and_remote_probe_does_not_restart(self):
        self.assertFalse(ingress.allows({**ingress.UDP_RULE, "cidr_v4": "10.0.0.0/8"}, "udp", 8082))
        compile(ingress.VM_PROBE, "video-probe", "exec")
        for word in ("restart", "reboot", "app.env", "privateKey"):
            self.assertNotIn(word, ingress.VM_PROBE)

    @patch("video_ingress.verify_media")
    @patch("video_ingress.verify_public")
    @patch("video_ingress.probe")
    def test_media_check_uses_private_temporary_config_without_installer(self, probe, public, media):
        values = {"api_key": "test-key", "api_secret": "test-private-secret"}
        probe.return_value = values
        with tempfile.TemporaryDirectory() as directory:
            private = Path(directory)
            api = Mock()
            ingress.check_media(api, private)
            config = private / "media.json"
            self.assertEqual(json.loads(config.read_text()), values)
            self.assertEqual(config.stat().st_mode & 0o777, 0o600)
            public.assert_called_once_with(values)
            media.assert_called_once_with(private, config, ingress.media_command)
            self.assertTrue(probe.call_args.kwargs["root"])
            compile(ingress.MEDIA_CONFIG, "private-media-config", "exec")


from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest

from control import ControlError
from inspect_video_ingress import SCRIPT, capture_duration, redact_network_output, ssh_options


class ReadOnlyVideoIngressTests(unittest.TestCase):
    def test_network_output_keeps_policy_but_withholds_addresses_and_comments(self):
        text = '-P INPUT ACCEPT\n-A input -s 8.8.8.8/32 -j DROP --comment "private-note"\nroute via 10.130.0.1\n' + 'A' * 43 + '\n2001:4860:4860::8888'
        redacted = redact_network_output(text)
        self.assertIn('-P INPUT ACCEPT', redacted)
        self.assertIn('-j DROP', redacted)
        self.assertIn('10.130.0.1', redacted)
        self.assertNotIn('8.8.8.8', redacted)
        self.assertNotIn('private-note', redacted)
        self.assertNotIn('A' * 43, redacted)
        self.assertNotIn('2001:4860:4860::8888', redacted)
        compile(SCRIPT, 'vm-ingress-diagnostics', 'exec')

    def test_capture_is_disabled_by_default_and_bounded(self):
        self.assertEqual(capture_duration(None), 0)
        self.assertEqual(capture_duration('90'), 90)
        for value in ('-1','91','unexpected'):
            with self.subTest(value=value), self.assertRaises(ControlError):
                capture_duration(value)

    def test_ssh_identity_is_pinned_and_private_files_are_restricted(self):
        values = {'attributes': {'username':'ubuntu','host':'158.160.209.13','privateKey':'test-only-private-material'}}
        api = SimpleNamespace(vm=lambda:{'status':'active','ip':'158.160.209.13'},request=lambda *args:values)
        with tempfile.TemporaryDirectory() as directory:
            options = ssh_options(api, Path(directory))
            self.assertIn('StrictHostKeyChecking=yes', options)
            self.assertEqual((Path(directory)/'ssh-key').stat().st_mode & 0o777, 0o600)
            self.assertNotIn('test-only-private-material', ' '.join(options))
            values['attributes']['host'] = 'other.example.test'
            with self.assertRaises(ControlError):
                ssh_options(api, Path(directory))
