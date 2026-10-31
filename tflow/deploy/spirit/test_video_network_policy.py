import io
import json
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from check_video_network_policy import inspect_policy, inspect_security_group
from control import BASE, VM_PATH, ControlError


class VideoNetworkPolicyTests(unittest.TestCase):
    @patch("check_video_network_policy.urlopen")
    def test_plain_security_group_response_is_supported_and_missing_rules_rejected(self, upstream):
        api = SimpleNamespace(token="test-token", vm=Mock())
        upstream.return_value = io.BytesIO(b'{"rules":[{"protocol":"udp","port_from":8082,"port_to":8082}]}')
        self.assertEqual(inspect_security_group(api)["rules"][0]["protocol"], "udp")
        upstream.return_value = io.BytesIO(b'{"unexpected":true}')
        with self.assertRaisesRegex(ControlError, "unrecognized rules schema"):
            inspect_security_group(api)

    @patch("check_video_network_policy.urlopen")
    def test_actual_security_group_is_read_without_returning_private_fields(self, upstream):
        attributes = {"rules": [{"direction": "ingress", "protocol": "tcp", "port_from": 8000,
            "port_to": 8100, "cidr_v4": "0.0.0.0/0", "description": "private-note"},
            {"cidr_v4": "8.8.8.8/32", "privateKey": "private-key"}], "lastAppliedAt": "test-time"}
        upstream.return_value = io.BytesIO(json.dumps({"attributes": attributes}).encode())
        api = SimpleNamespace(token="test-token", vm=Mock())
        result = inspect_security_group(api)
        api.vm.assert_called_once()
        self.assertEqual(upstream.call_args.args[0].full_url, BASE + VM_PATH.rsplit("/vm/", 1)[0] + "/sg")
        self.assertEqual(upstream.call_args.args[0].get_method(), "GET")
        self.assertEqual(result["rules"][0]["port_to"], 8100)
        self.assertIn("0.0.0.0/0", json.dumps(result))
        for value in ("private-note", "private-key", "test-token", "8.8.8.8"):
            self.assertNotIn(value, json.dumps(result))

    @patch("check_video_network_policy.urlopen")
    def test_only_owned_group_network_metadata_is_returned(self, upstream):
        group = VM_PATH.rsplit("/vm/", 1)[0]
        attributes = {"id": group.rsplit("/", 1)[1], "members": [{"privateKey": "private-value"}],
                      "networkRulesTemplates": [{"name": "Default", "identifier": {"name": "id", "value": "test-id"}}]}
        upstream.return_value = io.BytesIO(json.dumps({"attributes": attributes}).encode())
        api = SimpleNamespace(token="test-token", vm=Mock())
        result = inspect_policy(api)
        api.vm.assert_called_once()
        self.assertEqual(upstream.call_args.args[0].full_url, BASE + group)
        self.assertEqual(upstream.call_args.args[0].get_method(), "GET")
        self.assertIn("Default", json.dumps(result))
        self.assertNotIn("private-value", json.dumps(result))
        self.assertNotIn("test-token", json.dumps(result))

    @patch("check_video_network_policy.urlopen")
    def test_other_group_response_is_rejected(self, upstream):
        upstream.return_value = io.BytesIO(b'{"attributes":{"id":"other-group"}}')
        with self.assertRaisesRegex(ControlError, "different VM group"):
            inspect_policy(SimpleNamespace(token="test-token", vm=Mock()))
