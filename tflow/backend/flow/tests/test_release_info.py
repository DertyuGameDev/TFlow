import json
from pathlib import Path
import tempfile
from django.test import Client, SimpleTestCase, override_settings


class ReleaseInfoTests(SimpleTestCase):
    def test_public_version_and_html_are_never_cached_and_identify_same_release(self):
        with tempfile.TemporaryDirectory() as directory, override_settings(PROJECT_DIR=Path(directory)):
            dist = Path(directory) / "dist"
            dist.mkdir()
            (dist / "index.html").write_text("<main>new application</main>")
            (dist / "version.json").write_text(json.dumps({"id":"a"*40}))
            client = Client()
            version = client.get("/api/version")
            self.assertEqual(version.status_code, 200)
            self.assertEqual(version.json(), {"id":"a"*40})
            self.assertIn("no-store", version["Cache-Control"])
            page = client.get("/")
            self.assertEqual(page["X-TFlow-Release"], "a"*40)
            self.assertIn("no-store", page["Cache-Control"])
            self.assertEqual(b"".join(page.streaming_content), b"<main>new application</main>")

    def test_missing_build_info_has_safe_development_fallback(self):
        with tempfile.TemporaryDirectory() as directory, override_settings(PROJECT_DIR=Path(directory)):
            self.assertEqual(Client().get("/api/version").json(), {"id":"development"})
