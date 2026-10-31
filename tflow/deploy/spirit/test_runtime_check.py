import hashlib
from io import BytesIO
import json
import unittest
from runtime_check import verify_runtime


class RuntimeVerificationTests(unittest.TestCase):
    def setUp(self):
        self.commit = "a" * 40
        self.bodies = {"/api/version":json.dumps({"id":self.commit}).encode(), "/":b'<script src="/assets/app.js"></script>', "/assets/app.js":b"current application"}
        self.manifest = {"commit":self.commit,"frontend":{"index_sha256":hashlib.sha256(self.bodies["/"]).hexdigest(),"assets":{"/assets/app.js":hashlib.sha256(self.bodies["/assets/app.js"]).hexdigest()}}}

    def open(self, request, timeout):
        self.assertEqual(request.get_header("X-forwarded-proto"), "https")
        result = BytesIO(self.bodies[request.full_url.removeprefix("http://127.0.0.1:8000")])
        result.status = 200
        return result

    def test_exact_runtime_html_and_assets_pass(self):
        verify_runtime(self.manifest, "app.example.test", open_url=self.open)

    def test_old_process_cannot_pass_even_if_health_is_ok(self):
        self.bodies["/api/version"] = json.dumps({"id":"b"*40}).encode()
        with self.assertRaisesRegex(RuntimeError, "requested release"):
            verify_runtime(self.manifest, "app.example.test", open_url=self.open)

    def test_stale_html_or_javascript_is_rejected(self):
        for path in ["/", "/assets/app.js"]:
            with self.subTest(path=path):
                original = self.bodies[path]
                self.bodies[path] = b"old cached version"
                with self.assertRaises(RuntimeError):
                    verify_runtime(self.manifest, "app.example.test", open_url=self.open)
                self.bodies[path] = original
