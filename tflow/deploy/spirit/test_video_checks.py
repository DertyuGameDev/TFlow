from contextlib import redirect_stdout
import io
import json
import unittest
from unittest.mock import patch

import jwt
from control import ControlError
from video_checks import VM_CHECK, list_rooms_token, network_metadata, verify_public


class VideoTransportCheckTests(unittest.TestCase):
    def setUp(self):
        self.values = {"api_key": "test_only_key_abcdefghijklmnopqrstuvwxyz",
                       "api_secret": "test_only_secret_abcdefghijklmnopqrstuvwxyz"}

    def test_network_diagnostics_omit_credential_fields(self):
        result = network_metadata({"privateKey": "private-value", "networkAccessToken": "private-value",
            "networkRules": {"id": "test-id", "attributes": {"name": "Default", "privateKey": "private-value",
                              "rules": [{"port": 8080, "sourceCidr": "0.0.0.0/0"}]}}})
        text = json.dumps(result)
        self.assertNotIn("private-value", text)
        self.assertIn("0.0.0.0/0", text)

    def test_probe_token_can_only_list_rooms_and_expires_quickly(self):
        claims = jwt.decode(list_rooms_token(self.values), self.values["api_secret"], algorithms=["HS256"])
        self.assertEqual(claims["video"], {"roomList": True})
        self.assertLessEqual(claims["exp"] - claims["nbf"], 65)
        compile(VM_CHECK, "vm-network-check", "exec")

    @patch("video_checks.urlopen", side_effect=OSError("private-value"))
    def test_public_connection_failure_is_actionable_and_does_not_leak_output(self, upstream):
        with self.assertRaises(ControlError) as error:
            verify_public(self.values)
        self.assertIn("Spirit ingress", str(error.exception))
        self.assertNotIn("private-value", str(error.exception))

    @patch("video_checks.ssl.create_default_context")
    @patch("video_checks.socket.create_connection")
    @patch("video_checks.urlopen")
    def test_success_checks_signaling_api_media_and_turn_without_printing_keys(self, upstream, connect, tls):
        first, second = io.BytesIO(b"OK"), io.BytesIO(b'{"rooms":[]}')
        first.status = second.status = 200
        upstream.side_effect = [first, second]
        output = io.StringIO()
        with redirect_stdout(output):
            verify_public(self.values)
        self.assertEqual(connect.call_count, 2)
        self.assertEqual(tls.call_count, 1)
        self.assertIn("checks passed", output.getvalue())
        self.assertNotIn(self.values["api_key"], output.getvalue())
        self.assertNotIn(self.values["api_secret"], output.getvalue())
