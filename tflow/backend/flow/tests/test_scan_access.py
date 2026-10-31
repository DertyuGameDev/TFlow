from datetime import timedelta
from unittest.mock import patch

from django.contrib.auth.models import AnonymousUser
from django.test import TestCase, override_settings
from django.utils import timezone

from flow.contracts import FlowError
from flow.models import EventAccessKey, User
from flow.access_keys import issue_key, resolve_key, revoke_key
from .test_api import FAST_HASHER, Scenario


@override_settings(PASSWORD_HASHERS=FAST_HASHER)
class EventAccessKeyTests(Scenario, TestCase):
    def setUp(self):
        super().setUp()
        self.publish()
        self.event.format = "Гибрид"
        self.event.save(update_fields=["format"])
        for room in [self.r1, self.r2]:
            room.is_online = True
            room.save(update_fields=["is_online"])

    def assert_code(self, code, fn, *args, **kwargs):
        with self.assertRaises(FlowError) as caught:
            fn(*args, **kwargs)
        self.assertEqual(caught.exception.code, code)

    def test_secret_is_not_stored_and_different_flows_have_different_keys(self):
        one, first = issue_key(self.owner, self.event.pk, activity_id=self.a.pk, purpose="webinar")
        two, second = issue_key(self.owner, self.event.pk, activity_id=self.d.pk, purpose="webinar")
        self.assertGreaterEqual(len(first), 32)
        self.assertNotEqual(first, second)
        self.assertNotEqual(one.token_hash, first)
        self.assertNotEqual(two.token_hash, second)
        self.assertNotIn(first, str(list(EventAccessKey.objects.values())))
        self.assertEqual(resolve_key(self.person, first).activity_id, self.a.pk)

    def test_key_can_only_be_issued_and_revoked_by_event_owner(self):
        other_host = User.objects.create_user("scanner-host@example.test", None, role="organizer")
        for user in [self.person, other_host]:
            self.assert_code("FORBIDDEN", issue_key, user, self.event.pk)
            self.assert_code("FORBIDDEN", revoke_key, user, self.event.pk)
        self.assertFalse(EventAccessKey.objects.exists())

    def test_key_is_bound_to_its_event_and_activity(self):
        _, secret = issue_key(self.owner, self.event.pk, activity_id=self.a.pk, purpose="webinar")
        self.assert_code("INVALID_SCAN_KEY", resolve_key, self.person, secret, activity_id=self.d.pk, purpose="webinar")
        self.assert_code("INVALID_SCAN_KEY", resolve_key, self.person, secret, event_id="another-event")
        self.assertEqual(resolve_key(self.person, secret, event_id=self.event.pk, activity_id=self.a.pk, purpose="webinar").event_id, self.event.pk)

    def test_revoke_one_key_does_not_revoke_another_flow(self):
        _, first = issue_key(self.owner, self.event.pk, activity_id=self.a.pk, purpose="webinar")
        _, second = issue_key(self.owner, self.event.pk, activity_id=self.d.pk, purpose="webinar")
        revoke_key(self.owner, self.event.pk, activity_id=self.a.pk, purpose="webinar")
        self.assert_code("INVALID_SCAN_KEY", resolve_key, self.person, first)
        self.assertEqual(resolve_key(self.person, second).activity_id, self.d.pk)

    def test_regeneration_revokes_previous_key_and_keeps_audit_history(self):
        old, first = issue_key(self.owner, self.event.pk)
        new, second = issue_key(self.owner, self.event.pk)
        self.assert_code("INVALID_SCAN_KEY", resolve_key, self.person, first)
        self.assertEqual(resolve_key(self.person, second).pk, new.pk)
        old.refresh_from_db()
        self.assertIsNotNone(old.revoked_at)
        self.assertEqual(EventAccessKey.objects.filter(event=self.event).count(), 2)

    def test_expired_and_malformed_keys_do_not_resolve(self):
        key, secret = issue_key(self.owner, self.event.pk)
        EventAccessKey.objects.filter(pk=key.pk).update(expires_at=timezone.now()-timedelta(seconds=1))
        for value in [secret, "", None, {}, "x"*200, "x"*43]:
            self.assert_code("INVALID_SCAN_KEY", resolve_key, self.person, value)

    def test_inactive_and_anonymous_accounts_cannot_resolve_key(self):
        _, secret = issue_key(self.owner, self.event.pk)
        self.assert_code("UNAUTHORIZED", resolve_key, AnonymousUser(), secret)
        self.person.is_active = False
        self.assert_code("UNAUTHORIZED", resolve_key, self.person, secret)

    def test_draft_or_ended_event_does_not_allow_delegated_scanning(self):
        _, secret = issue_key(self.owner, self.event.pk)
        self.event.status = "draft"
        self.event.save(update_fields=["status"])
        self.assert_code("SCAN_CLOSED", resolve_key, self.person, secret)
        self.event.status = "published"
        self.event.ends_at = timezone.now()-timedelta(seconds=1)
        self.event.starts_at = self.event.ends_at-timedelta(hours=1)
        self.event.save(update_fields=["status", "starts_at", "ends_at"])
        self.assert_code("INVALID_SCAN_KEY", resolve_key, self.person, secret)
        self.assert_code("SCAN_CLOSED", issue_key, self.owner, self.event.pk)

    def test_owner_change_invalidates_keys_and_permission_does_not_change_role(self):
        _, secret = issue_key(self.owner, self.event.pk)
        resolve_key(self.person, secret)
        self.person.refresh_from_db()
        self.assertEqual(self.person.role, "participant")
        self.assertFalse(self.person.is_staff or self.person.is_superuser)
        other = User.objects.create_user("new-scanner-owner@example.test", None, role="organizer")
        self.event.owner = other
        self.event.save(update_fields=["owner"])
        self.assert_code("INVALID_SCAN_KEY", resolve_key, self.person, secret)

    def test_failed_key_generation_does_not_revoke_working_key(self):
        _, secret = issue_key(self.owner, self.event.pk)
        with patch("flow.access_keys.secrets.token_urlsafe", side_effect=RuntimeError("test failure")):
            with self.assertRaises(RuntimeError):
                issue_key(self.owner, self.event.pk)
        self.assertEqual(resolve_key(self.person, secret).event_id, self.event.pk)
