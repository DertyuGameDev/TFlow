import io
import json
import unittest
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
