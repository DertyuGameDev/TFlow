import hashlib
import hmac
from io import BytesIO
import json
import time
from unittest.mock import patch

from django.test import Client, SimpleTestCase, override_settings


@override_settings(TFLOW_DNS_HOOK_SECRET="test-hook-only-secret", TFLOW_DUCKDNS_TOKEN="test-provider-only-token")
class DnsChallengeTests(SimpleTestCase):
    def post(self, body=None, signature=None):
        raw = json.dumps(body if body is not None else {"txt": "a"*43, "clear": False, "timestamp": int(time.time())}).encode()
        signature = signature if signature is not None else hmac.new(b"test-hook-only-secret",raw,hashlib.sha256).hexdigest()
        return Client(enforce_csrf_checks=True).post("/api/internal/dns-challenge",data=raw,content_type="application/json",HTTP_X_TFLOW_HOOK_SIGNATURE=signature)

    @patch("flow.deploy_hooks.urlopen")
    def test_signed_request_only_updates_owned_txt_and_returns_no_credentials(self, upstream):
        upstream.return_value = BytesIO(b"OK")
        response = self.post()
        self.assertEqual(response.status_code,200)
        self.assertEqual(response.json(),{"ok":True})
        url=upstream.call_args.args[0].full_url
        self.assertTrue(url.startswith("https://www.duckdns.org/update?domains=tflow-video-162f2c&"))
        self.assertNotIn("&ip=",url)
        self.assertNotIn("token",response.content.decode())

    @patch("flow.deploy_hooks.urlopen")
    def test_missing_or_incorrect_signature_cannot_call_provider(self, upstream):
        for signature in ["","wrong"]:
            self.assertEqual(self.post(signature=signature).status_code,403)
        upstream.assert_not_called()

    @patch("flow.deploy_hooks.urlopen")
    def test_expired_and_invalid_payloads_cannot_change_dns(self, upstream):
        good={"txt":"a"*43,"clear":False,"timestamp":int(time.time())}
        for changes in [{"timestamp":int(time.time())-120},{"timestamp":True},{"txt":"arbitrary record"},{"clear":"true"},{"domain":"foreign.example.test"}]:
            self.assertEqual(self.post({**good,**changes}).status_code,400)
        upstream.assert_not_called()

    @patch("flow.deploy_hooks.urlopen", side_effect=TimeoutError("private provider URL"))
    def test_provider_failure_is_not_reported_as_success_or_echoed(self, upstream):
        response=self.post()
        self.assertEqual(response.status_code,503)
        self.assertNotIn("private",response.content.decode())

    @override_settings(TFLOW_DUCKDNS_TOKEN="")
    @patch("flow.deploy_hooks.urlopen")
    def test_unconfigured_relay_is_closed(self, upstream):
        self.assertEqual(self.post().status_code,503)
        upstream.assert_not_called()
