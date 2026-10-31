from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import patch
import urllib.error

from control import HOST, ControlError
from deploy import gateway_checks
from gateway_config import GATEWAY_HOST, configure


class GatewayConfigurationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.environment = self.directory / "app.env"
        self.backups = self.directory / "backups"
        self.original = f"DJANGO_ALLOWED_HOSTS={HOST},127.0.0.1\nDJANGO_CSRF_TRUSTED_ORIGINS=https://{HOST}\nDJANGO_SECRET_KEY=unit-only$secret=value\nDATABASE_URL=unit-only-database\nDJANGO_DEBUG=0\nDJANGO_HTTPS_REDIRECT=1\n"
        self.environment.write_text(self.original)

    def test_gateway_adds_https_origin_and_preserves_secrets_and_security(self):
        self.assertTrue(configure(self.environment, self.backups, GATEWAY_HOST))
        values = dict(line.split("=", 1) for line in self.environment.read_text().splitlines())
        self.assertIn(GATEWAY_HOST, values["DJANGO_ALLOWED_HOSTS"].split(","))
        self.assertIn("https://" + GATEWAY_HOST, values["DJANGO_CSRF_TRUSTED_ORIGINS"].split(","))
        self.assertEqual(values["TFLOW_PUBLIC_URL"], "https://" + GATEWAY_HOST)
        self.assertEqual(values["DJANGO_SECRET_KEY"], "unit-only$secret=value")
        self.assertEqual(values["DATABASE_URL"], "unit-only-database")
        self.assertEqual((values["DJANGO_DEBUG"], values["DJANGO_HTTPS_REDIRECT"]), ("0", "1"))
        backup = next(self.backups.iterdir())
        self.assertEqual(backup.read_text(), self.original)
        for path in (backup, self.environment):
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)

    def test_retry_does_not_duplicate_settings_or_create_another_backup(self):
        configure(self.environment, self.backups, GATEWAY_HOST)
        expected = self.environment.read_text()
        self.assertFalse(configure(self.environment, self.backups, GATEWAY_HOST))
        self.assertEqual(self.environment.read_text(), expected)
        self.assertEqual(len(list(self.backups.iterdir())), 1)

    def test_foreign_gateway_cannot_modify_the_environment(self):
        with self.assertRaises(ValueError):
            configure(self.environment, self.backups, "another.teleport.t-education.com")
        self.assertEqual(self.environment.read_text(), self.original)
        self.assertFalse(self.backups.exists())

    @patch("deploy.urllib.request.build_opener")
    def test_gateway_requires_https_redirect_to_cu_authentication(self, build):
        build.return_value.open.side_effect = urllib.error.HTTPError(
            "https://" + GATEWAY_HOST, 302, "Found",
            {"Location": "https://teleport.t-education.com/web/launch/app"}, None)
        gateway_checks()

    @patch("deploy.urllib.request.build_opener")
    def test_gateway_rejects_insecure_authentication_redirect(self, build):
        build.return_value.open.side_effect = urllib.error.HTTPError(
            "https://" + GATEWAY_HOST, 302, "Found",
            {"Location": "http://teleport.t-education.com/web/launch/app"}, None)
        with self.assertRaises(ControlError):
            gateway_checks()


if __name__ == "__main__":
    unittest.main()
