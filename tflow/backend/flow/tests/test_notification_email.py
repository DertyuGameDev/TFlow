from datetime import timedelta
from unittest.mock import patch
from django.core import mail
from django.db import transaction
from django.test import TestCase, override_settings
from django.utils import timezone
from flow.mailing import claim_email, create_notifications, send_pending_emails
from flow.models import Community, EventRegistration, Membership, Notification, NotificationEmail, Registration
from .test_api import FAST_HASHER, Scenario


@override_settings(
    PASSWORD_HASHERS=FAST_HASHER,
    EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
    NOTIFICATION_EMAIL_ENABLED=True,
    DEFAULT_FROM_EMAIL="notifications@example.test",
    PUBLIC_APP_URL="https://tflow.example.test",
)
class NotificationEmailTests(Scenario, TestCase):
    def test_club_event_change_emails_registered_users_not_every_club_member(self):
        self.publish()
        club = Community.objects.create(
            owner=self.owner, name="Клуб", description="Встречи сообщества",
            topic="Музыка", color="yellow",
        )
        for person in [self.owner, self.person, self.other]:
            Membership.objects.create(user=person, community=club)
        self.event.community = club
        self.event.save(update_fields=["community"])
        EventRegistration.objects.create(user=self.person, event=self.event)
        self.request(
            f"events/{self.event.pk}", "patch",
            self.event_body(title="Новая тема встречи", community_id=club.pk),
        )
        self.assertEqual(send_pending_emails()["sent"], 1)
        self.assertEqual(mail.outbox[0].to, [self.person.email])
        self.assertIn("Новая тема встречи", mail.outbox[0].body)
        self.assertEqual(mail.outbox[0].cc, [])
        self.assertEqual(mail.outbox[0].bcc, [])

    def test_saving_unchanged_activity_does_not_queue_email(self):
        self.publish()
        EventRegistration.objects.create(user=self.person, event=self.event)
        Registration.objects.create(user=self.person, activity=self.a)
        self.request(f"activities/{self.a.pk}", "patch", self.activity_body(self.a))
        self.assertFalse(Notification.objects.exists())
        self.assertFalse(NotificationEmail.objects.exists())

    def test_repeating_activity_update_does_not_queue_duplicate_email(self):
        self.publish()
        EventRegistration.objects.create(user=self.person, event=self.event)
        Registration.objects.create(user=self.person, activity=self.a)
        body = self.activity_body(self.a, title="Изменённая лекция")
        for _ in range(2):
            self.request(f"activities/{self.a.pk}", "patch", body)
        self.assertEqual(Notification.objects.count(), 1)
        self.assertEqual(send_pending_emails()["sent"], 1)
        self.assertEqual(len(mail.outbox), 1)

    def test_move_to_current_time_and_place_does_not_queue_email(self):
        self.publish()
        EventRegistration.objects.create(user=self.person, event=self.event)
        body = self.event_body()
        self.request(
            f"events/{self.event.pk}/move", "patch",
            {key: body[key] for key in ["starts_at", "ends_at", "city", "venue", "address"]},
        )
        self.assertFalse(Notification.objects.exists())
        self.assertFalse(NotificationEmail.objects.exists())

    def test_repeating_event_move_only_emails_once(self):
        self.publish()
        EventRegistration.objects.create(user=self.person, event=self.event)
        body = self.event_body()
        values = {key: body[key] for key in ["starts_at", "ends_at", "city", "venue", "address"]}
        values["starts_at"] += 3_600_000
        values["ends_at"] += 3_600_000
        for _ in range(2):
            self.request(f"events/{self.event.pk}/move", "patch", values)
        self.assertEqual(NotificationEmail.objects.count(), 1)
        self.assertEqual(send_pending_emails()["sent"], 1)
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn("перенесено", mail.outbox[0].body)

    def test_cancellation_queues_private_email_for_each_participant_and_sends_once(
        self,
    ):
        for person in [self.person, self.other]:
            EventRegistration.objects.create(user=person, event=self.event)
        self.request(f"events/{self.event.pk}", "delete")
        self.assertEqual(NotificationEmail.objects.count(), 2)
        self.assertEqual(send_pending_emails()["sent"], 2)
        self.assertEqual(
            {message.to[0] for message in mail.outbox},
            {self.person.email, self.other.email},
        )
        for message in mail.outbox:
            self.assertEqual(len(message.to), 1)
            self.assertEqual(message.cc, [])
            self.assertIn("Организатор отменил", message.body)
            self.assertIn(self.event.title, message.body)
            self.assertIn("https://tflow.example.test/#notifications", message.body)
            self.assertNotIn(str(self.person.pass_token), message.body)
        self.assertEqual(send_pending_emails()["sent"], 0)
        self.assertEqual(len(mail.outbox), 2)

    def test_smtp_failure_retains_job_and_retry_recovers(self):
        create_notifications(
            [Notification(user=self.person, message="Изменение времени")]
        )
        with patch(
            "flow.mailing.EmailMultiAlternatives.send",
            side_effect=OSError("sensitive SMTP detail"),
        ):
            self.assertEqual(send_pending_emails()["failed"], 1)
        job = NotificationEmail.objects.get()
        self.assertIsNone(job.sent_at)
        self.assertIsNone(job.locked_until)
        self.assertEqual(job.last_error, "OSError")
        self.assertGreater(job.next_attempt_at, timezone.now())
        self.assertEqual(send_pending_emails()["sent"], 0)
        job.next_attempt_at = timezone.now() - timedelta(seconds=1)
        job.save(update_fields=["next_attempt_at"])
        self.assertEqual(send_pending_emails()["sent"], 1)
        job.refresh_from_db()
        self.assertEqual(job.attempts, 2)
        self.assertIsNotNone(job.sent_at)

    @override_settings(NOTIFICATION_EMAIL_ENABLED=False)
    def test_unconfigured_sender_keeps_pending_messages(self):
        create_notifications(
            [Notification(user=self.person, message="Важное сообщение")]
        )
        self.assertFalse(send_pending_emails()["configured"])
        self.assertEqual(NotificationEmail.objects.get().attempts, 0)

    def test_transaction_rollback_does_not_queue_or_send(self):
        with self.assertRaises(RuntimeError):
            with transaction.atomic():
                create_notifications([Notification(user=self.person, message="Откат")])
                raise RuntimeError("rollback")
        self.assertFalse(Notification.objects.exists())
        self.assertFalse(NotificationEmail.objects.exists())

    def test_worker_lease_prevents_duplicate_claim_and_recovers_after_expiry(self):
        create_notifications([Notification(user=self.person, message="Сообщение")])
        job = claim_email()
        self.assertIsNone(claim_email())
        NotificationEmail.objects.filter(pk=job.pk).update(
            locked_until=timezone.now() - timedelta(seconds=1)
        )
        self.assertEqual(claim_email().pk, job.pk)

    def test_html_escapes_message_text(self):
        create_notifications(
            [Notification(user=self.person, message="Тема <script>alert(1)</script>")]
        )
        send_pending_emails()
        html = mail.outbox[0].alternatives[0].content
        self.assertNotIn("<script>", html)
        self.assertIn("&lt;script&gt;", html)
