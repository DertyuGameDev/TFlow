from datetime import timedelta
from unittest.mock import patch

from django.test import TestCase, override_settings
from django.utils import timezone

from flow.models import EventRegistration, Registration, WaitlistEntry
from flow.serializers import milliseconds
from flow.webinars import event_for_webinar
from .test_api import FAST_HASHER, Scenario


@override_settings(PASSWORD_HASHERS=FAST_HASHER)
class OpenActivityTests(Scenario, TestCase):
    def setUp(self):
        super().setUp()
        self.publish()
        self.a.registration_required = False
        self.a.save()

    def enroll(self, user):
        return EventRegistration.objects.create(user=user, event=self.event, profile_data={})

    def test_only_event_participants_can_add_open_activity_and_no_ticket_is_created_implicitly(self):
        self.request(f"activities/{self.a.pk}/registration", "post", client=self.participant,
                     status=403, code="EVENT_REGISTRATION_REQUIRED")
        self.assertFalse(EventRegistration.objects.exists())
        self.assertFalse(Registration.objects.exists())
        self.enroll(self.person)
        self.request(f"activities/{self.a.pk}/registration", "post", client=self.participant)
        self.assertTrue(Registration.objects.filter(activity=self.a, user=self.person).exists())
        state = self.request("bootstrap", client=self.participant)
        planned = next(item for item in state["schedule"] if item["id"] == self.a.pk)
        self.assertFalse(planned["registration_required"])
        self.assertTrue(planned["event_enrolled"])

    def test_calendar_entries_have_no_seat_quota_and_cannot_join_waitlist(self):
        for user, client in [(self.person, self.participant), (self.other, self.stranger)]:
            self.enroll(user)
            self.request(f"activities/{self.a.pk}/registration", "post", client=client)
        self.assertEqual(self.a.registrations.count(), 2)
        self.assertEqual(self.a.capacity, 1)
        self.request(f"activities/{self.a.pk}/waitlist", "post", client=self.participant,
                     status=400, code="REGISTRATION_NOT_REQUIRED")

    @patch("flow.webinars.disconnect_viewer")
    def test_removing_calendar_entry_keeps_ticket_and_open_access(self, disconnect):
        self.enroll(self.person)
        Registration.objects.create(user=self.person, activity=self.a)
        self.request(f"activities/{self.a.pk}/registration", "delete", client=self.participant)
        self.assertFalse(self.a.registrations.exists())
        self.assertTrue(EventRegistration.objects.filter(user=self.person, event=self.event).exists())
        disconnect.assert_not_called()

    def test_personal_schedule_conflicts_are_still_checked(self):
        self.enroll(self.person)
        Registration.objects.create(user=self.person, activity=self.b)
        self.request(f"activities/{self.a.pk}/registration", "post", client=self.participant,
                     status=409, code="PARTICIPANT_CONFLICT")
        self.assertFalse(self.a.registrations.exists())

    def test_open_activity_can_be_added_while_running_but_not_after_ending(self):
        self.enroll(self.person)
        now = timezone.now()
        self.a.starts_at, self.a.ends_at = now - timedelta(minutes=10), now + timedelta(minutes=10)
        self.a.save()
        self.request(f"activities/{self.a.pk}/registration", "post", client=self.participant)
        self.request(f"activities/{self.a.pk}/registration", "delete", client=self.participant)
        self.a.ends_at = now - timedelta(seconds=1)
        self.a.save()
        self.request(f"activities/{self.a.pk}/registration", "post", client=self.participant,
                     status=409, code="REGISTRATION_CLOSED")

    def test_legacy_patch_keeps_open_mode_and_return_to_booking_cannot_overbook(self):
        for user in [self.person, self.other]:
            self.enroll(user)
            Registration.objects.create(user=user, activity=self.a)
        self.request(f"activities/{self.a.pk}", "patch", self.activity_body(self.a, title="Новое название"))
        self.a.refresh_from_db()
        self.assertFalse(self.a.registration_required)
        self.request(f"activities/{self.a.pk}", "patch", self.activity_body(self.a, registration_required=True),
                     status=409, code="BELOW_REGISTERED")
        self.a.refresh_from_db()
        self.assertFalse(self.a.registration_required)
        self.assertEqual(self.a.registrations.count(), 2)

    def test_owner_can_choose_mode_on_create_and_drop_obsolete_queue_on_change(self):
        created = self.request(f"events/{self.event.pk}/activities", "post", self.activity_body(
            self.d, title="Открытый пункт", starts_at=milliseconds(self.d.ends_at),
            ends_at=milliseconds(self.d.ends_at + timedelta(hours=1)), registration_required=False), status=201)
        detail = self.request(f"events/{self.event.pk}")
        self.assertFalse(next(a for a in detail["activities"] if a["id"] == created["id"])["registration_required"])
        self.enroll(self.person)
        WaitlistEntry.objects.create(user=self.person, activity=self.c)
        self.request(f"activities/{self.c.pk}", "patch", self.activity_body(self.c, registration_required=False))
        self.assertFalse(self.c.waitlist.exists())
        self.request(f"activities/{self.c.pk}", "patch", self.activity_body(self.c, registration_required=True))
        self.c.refresh_from_db()
        self.assertTrue(self.c.registration_required)

    def test_open_online_activity_access_uses_event_ticket_not_calendar_entry(self):
        self.event.format = "Гибрид"
        self.event.save()
        self.r1.is_online = True
        self.r1.save()
        self.enroll(self.person)
        event, owner, activity = event_for_webinar(self.person, self.event.pk, activity_id=self.a.pk)
        self.assertEqual(activity.pk, self.a.pk)
        self.assertFalse(owner)
        self.assertFalse(self.a.registrations.exists())
        from flow.contracts import FlowError
        with self.assertRaises(FlowError):
            event_for_webinar(self.other, event.pk, activity_id=activity.pk)
