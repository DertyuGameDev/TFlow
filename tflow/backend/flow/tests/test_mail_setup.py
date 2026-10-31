import contextlib
import importlib.util
from io import StringIO
from pathlib import Path
import stat
import tempfile
from unittest import TestCase
from unittest.mock import patch

from django.conf import settings

spec = importlib.util.spec_from_file_location(
    "tflow_mail_setup", settings.PROJECT_DIR / "scripts" / "setup-mail.py"
)
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)


class MailSetupTests(TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / ".env.mail"
        self.output = StringIO()
        for patcher in [
            patch.object(setup, "MAIL_FILE", self.path),
            patch.object(setup.getpass, "getpass", return_value="private-app-password"),
            patch.object(setup.sys.stdin, "isatty", return_value=True),
        ]:
            patcher.start()
            self.addCleanup(patcher.stop)

    def run_setup(self, *args):
        with contextlib.redirect_stdout(self.output), contextlib.redirect_stderr(
            self.output
        ):
            return setup.main(list(args))

    @patch.object(setup.smtplib, "SMTP_SSL")
    def test_validates_smtp_and_saves_private_config_without_sending_mail(self, smtp):
        self.assertEqual(self.run_setup(), 0)
        connection = smtp.return_value.__enter__.return_value
        connection.login.assert_called_once_with(
            "support.tflow@yandex.ru", "private-app-password"
        )
        connection.sendmail.assert_not_called()
        connection.send_message.assert_not_called()
        self.assertEqual(stat.S_IMODE(self.path.stat().st_mode), 0o600)
        data = self.path.read_text()
        self.assertIn('NOTIFICATION_EMAIL_ENABLED="1"', data)
        self.assertIn('DEFAULT_FROM_EMAIL="ТФлоу <support.tflow@yandex.ru>"', data)
        self.assertNotIn("private-app-password", self.output.getvalue())
        self.assertIn("отдельный обработчик", self.output.getvalue())

    @patch.object(setup.smtplib, "SMTP_SSL")
    def test_auth_failure_preserves_existing_file_and_redacts_provider_response(
        self, smtp
    ):
        self.path.write_text("old-config")
        smtp.return_value.__enter__.return_value.login.side_effect = (
            setup.smtplib.SMTPAuthenticationError(
                535, b"private-app-password secret provider response"
            )
        )
        self.assertEqual(self.run_setup("--replace"), 1)
        self.assertEqual(self.path.read_text(), "old-config")
        self.assertNotIn("private-app-password", self.output.getvalue())
        self.assertNotIn("provider response", self.output.getvalue())

    @patch.object(setup.smtplib, "SMTP_SSL")
    def test_refuses_overwrite_and_noninteractive_secret_input(self, smtp):
        self.path.write_text("old-config")
        with self.assertRaises(SystemExit):
            self.run_setup()
        self.path.unlink()
        with patch.object(
            setup.sys.stdin, "isatty", return_value=False
        ), self.assertRaises(SystemExit):
            self.run_setup()
        smtp.assert_not_called()
        self.assertFalse(self.path.exists())

    @patch.object(setup.smtplib, "SMTP_SSL")
    def test_rejects_invalid_sender_url_and_empty_password_before_connection(
        self, smtp
    ):
        for arguments in [
            ("--sender", "support.tflow@"),
            ("--sender", "support.tflow@example.com"),
            ("--url", "https://user:password@example.com"),
            ("--url", "https://[invalid"),
            ("--url", 'https://example.com/"\nEXTRA=value'),
        ]:
            with self.subTest(arguments=arguments), self.assertRaises(SystemExit):
                self.run_setup(*arguments)
        with patch.object(setup.getpass, "getpass", return_value=""):
            self.assertEqual(self.run_setup(), 1)
        smtp.assert_not_called()
        self.assertFalse(self.path.exists())

    @patch.object(setup.smtplib, "SMTP_SSL")
    def test_connection_error_does_not_create_config_or_expose_details(self, smtp):
        smtp.side_effect = OSError("private-app-password smtp details")
        self.assertEqual(self.run_setup(), 1)
        self.assertFalse(self.path.exists())
        self.assertNotIn("private-app-password", self.output.getvalue())
        self.assertNotIn("smtp details", self.output.getvalue())
