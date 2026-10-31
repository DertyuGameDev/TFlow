import io
import json
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from check_video_network_policy import inspect_policy
from control import BASE, VM_PATH, ControlError


class VideoNetworkPolicyTests(unittest.TestCase):
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
