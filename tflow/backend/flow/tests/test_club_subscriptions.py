from unittest.mock import patch

from django.core import mail
from django.test import Client, TestCase, override_settings

from flow import services
from flow.mailing import send_pending_emails
from flow.models import Community, Membership, Notification, NotificationEmail, User
from .test_api import FAST_HASHER, Scenario


@override_settings(PASSWORD_HASHERS=FAST_HASHER, NOTIFICATION_EMAIL_ENABLED=False)
class ClubSubscriptionTests(Scenario, TestCase):
    def setUp(self):
        super().setUp()
        self.club = Community.objects.create(
            owner=self.owner, name="Клуб разработки", description="Встречи", topic="Разработка",
        )
        self.event.community = self.club
        self.event.save(update_fields=["community"])
        self.path = f"communities/{self.club.pk}"

    def test_join_subscribes_and_repeated_join_preserves_opt_out(self):
        self.request(self.path + "/join", "post", client=self.participant)
        self.assertTrue(Membership.objects.get(user=self.person, community=self.club).notify_events)
        self.request(self.path + "/subscription", "patch", {"enabled": False}, client=self.participant)
        self.request(self.path + "/join", "post", client=self.participant)
        membership = Membership.objects.get(user=self.person, community=self.club)
        self.assertFalse(membership.notify_events)
        state = self.request("bootstrap", client=self.participant)["communities"][0]
        self.assertEqual(state["joined"], 1)
        self.assertIs(state["subscribed"], False)
        self.request(self.path + "/subscription", "patch", {"enabled": True}, client=self.participant)
        self.assertIs(self.request("bootstrap", client=self.participant)["communities"][0]["subscribed"], True)

    def test_leave_removes_subscription_and_rejoin_starts_new_subscription(self):
        Membership.objects.create(user=self.person, community=self.club, notify_events=False)
        self.request(self.path + "/join", "delete", client=self.participant)
        self.assertFalse(Membership.objects.filter(user=self.person, community=self.club).exists())
        self.assertIs(self.request("bootstrap", client=self.participant)["communities"][0]["subscribed"], False)
        self.request(self.path + "/join", "post", client=self.participant)
        self.assertTrue(Membership.objects.get(user=self.person, community=self.club).notify_events)

    def test_only_members_can_change_their_own_subscription(self):
        Membership.objects.create(user=self.person, community=self.club)
        self.request(self.path + "/subscription", "patch", {"enabled": False}, client=Client(), status=401)
        self.request(self.path + "/subscription", "patch", {"enabled": False}, client=self.stranger, status=403, code="CLUB_MEMBERSHIP")
        self.request(self.path + "/subscription", "patch", {"enabled": False, "user_id": self.other.pk}, client=self.participant)
        self.assertFalse(Membership.objects.get(user=self.person, community=self.club).notify_events)
        self.assertFalse(Membership.objects.filter(user=self.other, community=self.club).exists())
        self.assertIs(self.request("bootstrap", client=Client())["communities"][0]["subscribed"], False)

    def test_subscription_requires_boolean_existing_club_and_csrf(self):
        Membership.objects.create(user=self.person, community=self.club)
        for value in [None, "false", 0, 1, [], {}]:
            with self.subTest(value=value):
                self.request(self.path + "/subscription", "patch", {"enabled": value}, client=self.participant, status=400)
        self.request("communities/absent/subscription", "patch", {"enabled": True}, client=self.participant, status=404)
        csrf = Client(enforce_csrf_checks=True)
        csrf.force_login(self.person)
        self.assertEqual(csrf.patch("/api/" + self.path + "/subscription", data='{"enabled": false}', content_type="application/json").status_code, 403)
        self.assertTrue(Membership.objects.get(user=self.person, community=self.club).notify_events)

    def test_publication_notifies_only_active_subscribers_once(self):
        for user in [self.owner, self.person]:
            Membership.objects.create(user=user, community=self.club)
        Membership.objects.create(user=self.other, community=self.club, notify_events=False)
        inactive = User.objects.create_user("inactive@example.test", "test", is_active=False)
        Membership.objects.create(user=inactive, community=self.club)
        User.objects.create_user("outsider@example.test", "test")
        self.assertFalse(Notification.objects.exists())
        for _ in range(2):
            self.request(f"events/{self.event.pk}/publish", "post")
        notice = Notification.objects.get(kind="club_event")
        self.assertEqual(notice.user_id, self.person.pk)
        self.assertEqual(notice.event_id, self.event.pk)
        self.assertIn(self.club.name, notice.message)
        self.assertIn(self.event.title, notice.message)
        self.assertEqual(NotificationEmail.objects.get().recipient, self.person.email)
        self.assertEqual(send_pending_emails(), {"sent": 0, "failed": 0, "configured": False})
        state = self.request("bootstrap", client=self.participant)
        self.assertEqual(state["unread_notification_count"], 1)
        self.assertEqual(state["notifications"][0]["kind"], "club_event")
        self.assertIn(self.event.pk, [event["id"] for event in state["events"]])

    def test_leaving_before_publication_prevents_notification(self):
        self.request(self.path + "/join", "post", client=self.participant)
        self.request(self.path + "/join", "delete", client=self.participant)
        self.request(f"events/{self.event.pk}/publish", "post")
        self.assertFalse(Notification.objects.exists())

    def test_publication_and_notice_roll_back_if_email_queue_fails(self):
        Membership.objects.create(user=self.person, community=self.club)
        with patch("flow.mailing.NotificationEmail.objects.bulk_create", side_effect=RuntimeError("queue failure")):
            with self.assertRaises(RuntimeError):
                services.publish_event(self.owner, self.event.pk)
        self.event.refresh_from_db()
        self.assertEqual(self.event.status, "draft")
        self.assertFalse(Notification.objects.exists())
        self.assertFalse(NotificationEmail.objects.exists())

    @override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend", NOTIFICATION_EMAIL_ENABLED=True, DEFAULT_FROM_EMAIL="notifications@example.test")
    def test_club_notification_uses_distinct_subject_and_private_recipient(self):
        Membership.objects.create(user=self.person, community=self.club)
        self.request(f"events/{self.event.pk}/publish", "post")
        self.assertEqual(send_pending_emails()["sent"], 1)
        self.assertEqual(mail.outbox[0].subject, "ТФлоу — новое событие клуба")
        self.assertEqual(mail.outbox[0].to, [self.person.email])
        self.assertEqual(mail.outbox[0].cc + mail.outbox[0].bcc, [])
