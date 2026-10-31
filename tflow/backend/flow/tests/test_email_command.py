from io import StringIO
from unittest.mock import patch

from django.core import mail
from django.core.management import call_command, CommandError
from django.test import TestCase, override_settings

from flow.mailing import create_notifications
from flow.models import Notification, NotificationEmail
from .test_api import FAST_HASHER, Scenario


@override_settings(
    PASSWORD_HASHERS=FAST_HASHER,
    EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
    NOTIFICATION_EMAIL_ENABLED=True,
    DEFAULT_FROM_EMAIL="notifications@example.test",
)
class EmailCommandTests(Scenario, TestCase):
    def setUp(self):
        super().setUp()
        create_notifications([
            Notification(user=self.person, message="Перенос первой встречи"),
            Notification(user=self.other, message="Перенос второй встречи"),
        ])

    def test_limit_controls_delivery_and_repeated_runs_do_not_duplicate_mail(self):
        output = StringIO()
        call_command("send_notification_emails", limit=1, stdout=output)
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(NotificationEmail.objects.filter(sent_at__isnull=False).count(), 1)
        self.assertEqual(NotificationEmail.objects.filter(attempts=0).count(), 1)
        call_command("send_notification_emails", limit=1, stdout=output)
        call_command("send_notification_emails", stdout=output)
        self.assertEqual(len(mail.outbox), 2)
        self.assertEqual({message.to[0] for message in mail.outbox}, {self.person.email, self.other.email})
        self.assertIn("Отправлено: 0", output.getvalue())

    def test_invalid_limit_does_not_claim_or_send_pending_mail(self):
        for value in [0, -1, 1001]:
            with self.subTest(value=value), self.assertRaises(CommandError):
                call_command("send_notification_emails", limit=value, stdout=StringIO())
        self.assertFalse(NotificationEmail.objects.exclude(attempts=0).exists())

    @override_settings(NOTIFICATION_EMAIL_ENABLED=False)
    def test_missing_configuration_explains_failure_without_losing_jobs(self):
        with self.assertRaisesMessage(CommandError, "Письма сохранены в очереди"):
            call_command("send_notification_emails", stdout=StringIO())
        self.assertEqual(NotificationEmail.objects.filter(attempts=0, sent_at=None).count(), 2)

    @patch("flow.mailing.EmailMultiAlternatives.send", return_value=0)
    def test_backend_refusal_is_retried_instead_of_reported_as_delivery(self, send):
        output = StringIO()
        call_command("send_notification_emails", limit=1, stdout=output)
        self.assertFalse(NotificationEmail.objects.filter(sent_at__isnull=False).exists())
        self.assertEqual(NotificationEmail.objects.filter(last_error="RuntimeError", attempts=1).count(), 1)
        self.assertIn("осталось для повтора: 1", output.getvalue())

    @patch("flow.management.commands.send_notification_emails.time.sleep")
    @patch("flow.management.commands.send_notification_emails.send_pending_emails")
    def test_watch_polls_without_spamming_idle_output_and_stops_cleanly(self, send, sleep):
        send.side_effect = [
            {"configured": True, "sent": 0, "failed": 0},
            {"configured": True, "sent": 1, "failed": 0},
            KeyboardInterrupt,
        ]
        output = StringIO()
        call_command("send_notification_emails", watch=True, limit=7, stdout=output)
        self.assertEqual(send.call_count, 3)
        self.assertEqual(send.call_args.args, (7,))
        self.assertEqual(sleep.call_count, 2)
        sleep.assert_called_with(2)
        self.assertEqual(output.getvalue().count("Отправлено:"), 1)
