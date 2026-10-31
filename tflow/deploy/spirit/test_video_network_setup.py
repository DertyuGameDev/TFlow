import io
import json
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from configure_video_network import configure, media_udp_allowed
from control import BASE, VM_PATH, ControlError


def policy(protocol="udp", port=8082, direction="ingress", cidr="0.0.0.0/0"):
    return {"rules": [{"direction": direction, "protocol": protocol,
                       "port_from": port, "port_to": port, "cidr_v4": cidr}]}


class VideoNetworkSetupTests(unittest.TestCase):
    def test_only_public_inbound_udp_coverage_counts(self):
        self.assertTrue(media_udp_allowed(policy()))
        for value in (policy("tcp"), policy(port=8081), policy(direction="egress"), policy(cidr="10.0.0.0/8")):
            self.assertFalse(media_udp_allowed(value))

    @patch("configure_video_network.urlopen")
    @patch("configure_video_network.inspect_security_group")
    def test_adds_one_exact_media_rule_and_verifies_it(self, inspect, upstream):
        api = SimpleNamespace(token="test-token", vm=Mock(return_value={"status": "active", "ip": "158.160.209.13"}))
        inspect.side_effect = [policy("tcp"), policy()]
        upstream.return_value = io.BytesIO(b'{}')
        self.assertTrue(configure(api)["changed"])
        request = upstream.call_args.args[0]
        self.assertEqual(request.full_url, BASE + VM_PATH.rsplit("/vm/", 1)[0] + "/sg/rules")
        self.assertEqual(request.get_method(), "POST")
        body = json.loads(request.data)
        self.assertEqual(body["kind"], "SgRuleCreatePayload")
        payload = body["attributes"]
        self.assertEqual((payload["protocol"], payload["port_from"], payload["port_to"]), ("udp", 8082, 8082))
        upstream.assert_called_once()

    @patch("configure_video_network.urlopen")
    @patch("configure_video_network.inspect_security_group", return_value=policy())
    def test_existing_rule_is_not_duplicated_and_other_vm_is_rejected(self, inspect, upstream):
        api = SimpleNamespace(token="test-token", vm=Mock(return_value={"status": "active", "ip": "158.160.209.13"}))
        self.assertFalse(configure(api)["changed"])
        upstream.assert_not_called()
        api.vm.return_value["ip"] = "other"
        with self.assertRaises(ControlError):
            configure(api)
        upstream.assert_not_called()
