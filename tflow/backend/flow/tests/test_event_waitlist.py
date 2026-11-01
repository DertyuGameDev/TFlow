from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier
from unittest.mock import patch
import json

from django.db import close_old_connections, connections
from django.test import Client, TestCase, TransactionTestCase, override_settings
from django.utils import timezone
from flow import services
from flow.models import EventRegistration, EventWaitlistEntry, Notification, User
from .test_api import FAST_HASHER, Scenario


class EventQueueScenario(Scenario):
    def setUp(self):
        super().setUp()
        self.event.capacity, self.event.status = 1, "published"
        self.event.save()
        EventRegistration.objects.create(user=self.person, event=self.event)
        self.path = f"events/{self.event.pk}/waitlist"

    def new_waiter(self, email="next@example.test"):
        user = User.objects.create_user(email, "test", name="Следующий участник")
        client = Client()
        client.force_login(user)
        return user, client


@override_settings(PASSWORD_HASHERS=FAST_HASHER)
class EventWaitlistTests(EventQueueScenario, TestCase):
    def test_join_is_idempotent_and_reports_private_position_without_a_ticket(self):
        for _ in range(2):
            result = self.request(self.path, "post", client=self.stranger)
            self.assertTrue(result["waitlisted"])
            self.assertFalse(result["registered"])
        self.assertEqual(EventWaitlistEntry.objects.count(), 1)
        self.assertFalse(self.event.enrollments.filter(user=self.other).exists())
        state = self.request("bootstrap", client=self.stranger)
        event = state["events"][0]
        self.assertEqual((event["event_waitlisted"], event["event_waitlist_position"], event["event_waiting_count"]), (1, 1, 1))
        self.assertEqual(state["tickets"], [])
        public = self.request("bootstrap", client=Client())["events"][0]
        self.assertEqual((public["event_waitlisted"], public["event_waitlist_position"]), (0, 0))
        self.request(f"events/{self.event.pk}/check-in", "post", {"qr": str(self.other.pass_token)}, status=409, code="NOT_REGISTERED")

    def test_cancellation_promotes_first_waiter_once_and_updates_remaining_position(self):
        third, third_client = self.new_waiter()
        self.request(self.path, "post", client=self.stranger)
        self.request(self.path, "post", client=third_client)
        self.request(f"events/{self.event.pk}/registration", "delete", client=self.participant)
        self.assertEqual(list(self.event.enrollments.values_list("user_id", flat=True)), [self.other.pk])
        self.assertEqual(list(self.event.waitlist_entries.values_list("user_id", flat=True)), [third.pk])
        self.assertEqual(self.request("bootstrap", client=third_client)["events"][0]["event_waitlist_position"], 1)
        self.request(f"events/{self.event.pk}/registration", "delete", client=self.participant)
        notice = Notification.objects.get(kind="event_waitlist")
        self.assertEqual(notice.user_id, self.other.pk)
        self.assertEqual(self.request("bootstrap", client=self.stranger)["tickets"][0]["event_waitlisted"], 0)

    def test_leave_removes_only_own_entry_and_rejoining_goes_to_end(self):
        third, third_client = self.new_waiter()
        self.request(self.path, "post", client=self.stranger)
        self.request(self.path, "post", client=third_client)
        self.request(self.path, "delete", {"user_id": third.pk}, client=self.stranger)
        self.assertTrue(EventWaitlistEntry.objects.filter(user=third).exists())
        self.request(self.path, "post", client=self.stranger)
        self.assertEqual(self.request("bootstrap", client=self.stranger)["events"][0]["event_waitlist_position"], 2)

    def test_stale_leave_after_promotion_does_not_cancel_the_ticket(self):
        self.request(self.path, "post", client=self.stranger)
        self.request(f"events/{self.event.pk}/registration", "delete", client=self.participant)
        self.request(self.path, "delete", client=self.stranger)
        self.assertTrue(self.event.enrollments.filter(user=self.other).exists())

    def test_free_seat_registers_immediately_instead_of_leaving_a_stale_queue_entry(self):
        self.event.enrollments.all().delete()
        result = self.request(self.path, "post", client=self.stranger)
        self.assertTrue(result["registered"])
        self.assertFalse(result["waitlisted"])
        self.assertTrue(self.event.enrollments.filter(user=self.other).exists())
        self.assertFalse(EventWaitlistEntry.objects.exists())

    def test_capacity_increase_promotes_waiters(self):
        self.request(self.path, "post", client=self.stranger)
        self.request(f"events/{self.event.pk}", "patch", self.event_body(capacity=2))
        self.assertEqual(self.event.enrollments.count(), 2)
        self.assertFalse(EventWaitlistEntry.objects.exists())
        self.assertEqual(Notification.objects.filter(kind="event_waitlist").count(), 1)

    def test_inactive_waiter_keeps_position_without_blocking_an_eligible_person(self):
        third, third_client = self.new_waiter()
        self.request(self.path, "post", client=self.stranger)
        self.request(self.path, "post", client=third_client)
        self.other.is_active = False
        self.other.save(update_fields=["is_active"])
        self.request(f"events/{self.event.pk}/registration", "delete", client=self.participant)
        self.assertTrue(self.event.enrollments.filter(user=third).exists())
        self.assertTrue(EventWaitlistEntry.objects.filter(user=self.other).exists())

    def test_profile_is_required_before_joining_and_snapshot_is_taken_at_promotion(self):
        self.event.required_profile_fields = ["phone"]
        self.event.save()
        self.request(self.path, "post", client=self.stranger, status=409, code="PROFILE_INCOMPLETE")
        self.assertFalse(EventWaitlistEntry.objects.exists())
        self.request(self.path, "post", {"phone": "123"}, client=self.stranger)
        self.request(f"events/{self.event.pk}/registration", "delete", client=self.participant)
        self.assertEqual(self.event.enrollments.get(user=self.other).profile_data["phone"], "123")

    def test_changed_requirements_keep_queue_position_until_profile_is_completed(self):
        self.request(self.path, "post", client=self.stranger)
        entry_id = EventWaitlistEntry.objects.get().pk
        self.request(f"events/{self.event.pk}/requirements", "patch", {"required_profile_fields": ["phone"]})
        self.request(f"events/{self.event.pk}/registration", "delete", client=self.participant)
        self.assertFalse(self.event.enrollments.exists())
        self.assertEqual(EventWaitlistEntry.objects.get().pk, entry_id)
        self.request("profile", "patch", {"phone": "123"}, client=self.stranger)
        self.assertTrue(self.event.enrollments.filter(user=self.other).exists())
        self.assertFalse(EventWaitlistEntry.objects.exists())

    def test_regular_and_activity_registration_cannot_jump_an_eligible_queue(self):
        third, third_client = self.new_waiter()
        self.request(self.path, "post", client=self.stranger)
        self.event.enrollments.all().delete()  # Simulate a stale free-seat snapshot.
        for path in [f"events/{self.event.pk}/registration", f"activities/{self.c.pk}/registration"]:
            self.request(path, "post", client=third_client, status=409, code="WAITLIST_PRIORITY")
        self.assertFalse(self.event.enrollments.exists())
        self.request(self.path, "post", client=self.stranger)
        self.assertTrue(self.event.enrollments.filter(user=self.other).exists())

    def test_roles_authentication_and_csrf_are_enforced(self):
        self.request(self.path, "post", client=Client(), status=401)
        self.request(self.path, "post", status=403, code="FORBIDDEN")
        self.request(self.path, "delete", status=403, code="FORBIDDEN")
        client = Client(enforce_csrf_checks=True)
        client.force_login(self.other)
        self.assertEqual(client.post('/api/' + self.path, data='{}', content_type='application/json').status_code, 403)
        self.assertFalse(EventWaitlistEntry.objects.exists())

    def test_draft_closed_and_missing_events_cannot_be_joined(self):
        self.request('events/absent/waitlist', 'post', client=self.stranger, status=404)
        self.event.status = 'draft'
        self.event.save()
        self.request(self.path, 'post', client=self.stranger, status=409, code='NOT_PUBLISHED')
        self.event.status = 'published'
        self.event.starts_at = timezone.now() - timedelta(hours=2)
        self.event.ends_at = timezone.now() - timedelta(hours=1)
        self.event.save()
        self.request(self.path, 'post', client=self.stranger, status=409, code='REGISTRATION_CLOSED')

    def test_deletion_notifies_queued_people_and_removes_queue(self):
        self.request(self.path, 'post', client=self.stranger)
        self.request(f'events/{self.event.pk}', 'delete')
        self.assertFalse(EventWaitlistEntry.objects.exists())
        self.assertTrue(Notification.objects.filter(user=self.other, kind='event_cancelled', event=None).exists())

    def test_notification_failure_rolls_back_cancellation_and_promotion(self):
        self.request(self.path, 'post', client=self.stranger)
        with patch('flow.services.create_notifications', side_effect=RuntimeError('outbox failure')):
            with self.assertRaises(RuntimeError):
                services.cancel_event(self.person, self.event.pk)
        self.assertTrue(self.event.enrollments.filter(user=self.person).exists())
        self.assertFalse(self.event.enrollments.filter(user=self.other).exists())
        self.assertTrue(EventWaitlistEntry.objects.filter(user=self.other).exists())

    def test_promoted_person_gets_one_site_notification(self):
        self.request(self.path, 'post', client=self.stranger)
        self.request(f'events/{self.event.pk}/registration', 'delete', client=self.participant)
        page = self.request('notifications', client=self.stranger)
        promotions = [item for item in page['items'] if item['kind'] == 'event_waitlist']
        self.assertEqual(len(promotions), 1)
        self.assertEqual(page['items'][0]['kind'], 'event_waitlist')
        self.assertEqual(page['items'][0]['event_id'], self.event.pk)


@override_settings(PASSWORD_HASHERS=FAST_HASHER)
class EventWaitlistConcurrencyTests(EventQueueScenario, TransactionTestCase):
    def race(self, calls):
        barrier = Barrier(len(calls))
        def run(call):
            close_old_connections()
            try:
                user, method, path = call
                client = Client()
                client.force_login(user)
                barrier.wait(timeout=15)
                return getattr(client, method)('/api/' + path, data='{}', content_type='application/json').status_code
            finally:
                connections.close_all()
        with ThreadPoolExecutor(max_workers=len(calls)) as pool:
            return list(pool.map(run, calls))

    def test_cancel_racing_a_new_registration_preserves_existing_waiter_priority(self):
        services.join_event_waitlist(self.other, self.event.pk)
        third, _ = self.new_waiter()
        statuses = self.race([(self.person, 'delete', f'events/{self.event.pk}/registration'), (third, 'post', f'events/{self.event.pk}/registration')])
        self.assertEqual(statuses, [200, 409])
        self.assertEqual(list(self.event.enrollments.values_list('user_id', flat=True)), [self.other.pk])

    def test_repeated_concurrent_join_creates_one_entry(self):
        self.assertEqual(self.race([(self.other, 'post', self.path)] * 8), [200] * 8)
        self.assertEqual(EventWaitlistEntry.objects.filter(user=self.other).count(), 1)

    def test_concurrent_waitlist_requests_for_one_free_seat_never_overbook(self):
        self.event.enrollments.all().delete()
        people = [self.new_waiter(f'race-{index}@example.test')[0] for index in range(8)]
        self.assertEqual(self.race([(user, 'post', self.path) for user in people]), [200] * 8)
        self.assertEqual(self.event.enrollments.count(), 1)
        self.assertEqual(self.event.waitlist_entries.count(), 7)
