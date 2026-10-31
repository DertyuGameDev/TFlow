from datetime import timedelta

from django.test import TestCase, override_settings

from flow.models import Activity, Notification, Registration
from flow.serializers import milliseconds
from .test_api import FAST_HASHER, Scenario


@override_settings(PASSWORD_HASHERS=FAST_HASHER)
class ProgramScheduleTests(Scenario, TestCase):
    def swap(self, first=None, second=None, **options):
        return self.request(f"activities/{(first or self.a).pk}/swap", "post",
                            {"other_id": (second or self.c).pk, **options.pop("body", {})}, **options)

    def test_unequal_adjacent_items_keep_duration_rooms_and_outer_bounds(self):
        self.c.ends_at = self.c.starts_at + timedelta(minutes=30)
        self.c.save()
        self.swap()
        self.a.refresh_from_db(); self.c.refresh_from_db()
        self.assertEqual((self.c.starts_at, self.c.ends_at), (self.start, self.start + timedelta(minutes=30)))
        self.assertEqual((self.a.starts_at, self.a.ends_at), (self.c.ends_at, self.start + timedelta(minutes=90)))
        self.assertEqual(self.a.room_id, self.r1.pk)
        self.assertEqual(self.a.capacity, 1)

    def test_middle_items_and_gaps_reflow_in_same_room(self):
        self.c.starts_at += timedelta(minutes=15)
        self.c.ends_at = self.c.starts_at + timedelta(minutes=30)
        self.c.save()
        last = Activity.objects.create(event=self.event, room=self.r1, title="Последний", capacity=2,
                                       starts_at=self.start + timedelta(hours=3), ends_at=self.start + timedelta(hours=5))
        self.swap(second=last)
        self.a.refresh_from_db(); self.c.refresh_from_db(); last.refresh_from_db()
        self.assertEqual(last.starts_at, self.start)
        self.assertEqual(last.ends_at, self.start + timedelta(hours=2))
        self.assertEqual(self.c.starts_at, last.ends_at + timedelta(minutes=15))
        self.assertEqual(self.c.ends_at - self.c.starts_at, timedelta(minutes=30))
        self.assertEqual(self.a.starts_at - self.c.ends_at, timedelta(minutes=75))
        self.assertEqual(self.a.ends_at, self.start + timedelta(hours=5))

    def test_preview_rolls_back_every_write_and_sends_no_notifications(self):
        Registration.objects.create(user=self.person, activity=self.a)
        before = list(Activity.objects.order_by("id").values())
        self.event.refresh_from_db()
        version = self.event.updated_at
        data = self.swap(body={"preview": True})
        self.assertTrue(data["preview"])
        self.assertEqual(len(data["changes"]), 2)
        self.assertEqual(before, list(Activity.objects.order_by("id").values()))
        self.event.refresh_from_db()
        self.assertEqual(version, self.event.updated_at)
        self.assertFalse(Notification.objects.exists())
        self.swap()
        self.assertTrue(Notification.objects.filter(user=self.person).exists())

    def test_cross_room_swap_preserves_room_and_duration(self):
        self.b.delete()
        self.swap(second=self.d)
        self.a.refresh_from_db(); self.d.refresh_from_db()
        self.assertEqual(self.a.starts_at, self.start + timedelta(hours=2))
        self.assertEqual(self.d.starts_at, self.start)
        self.assertEqual(self.a.room_id, self.r1.pk)
        self.assertEqual(self.d.room_id, self.r2.pk)

    def test_conflict_rolls_back_entire_schedule(self):
        before = list(Activity.objects.order_by("id").values())
        self.swap(second=self.b, status=409, code="ROOM_CONFLICT")
        self.assertEqual(before, list(Activity.objects.order_by("id").values()))
        self.assertFalse(Notification.objects.exists())

    def test_participant_conflict_is_checked_against_final_schedule(self):
        Registration.objects.create(user=self.person, activity=self.a)
        Registration.objects.create(user=self.person, activity=self.d)
        before = self.a.starts_at
        # A moves to 01:00–02:00; a different-room registration is now at 01:30.
        self.d.starts_at = self.start + timedelta(minutes=90)
        self.d.save()
        self.swap(status=409, code="ENROLLED_CONFLICT")
        self.a.refresh_from_db()
        self.assertEqual(self.a.starts_at, before)

    def test_out_of_event_swap_is_rejected_atomically(self):
        self.d.starts_at = self.event.ends_at - timedelta(minutes=30)
        self.d.ends_at = self.event.ends_at
        self.d.save()
        self.swap(second=self.d, status=409, code="EVENT_DATES")
        self.a.refresh_from_db()
        self.assertEqual(self.a.starts_at, self.start)

    def test_ownership_references_and_versions(self):
        self.swap(client=self.participant, status=403, code="FORBIDDEN")
        self.swap(second=self.a, status=400, code="VALIDATION")
        self.swap(body={"other_id": "missing"}, status=400, code="INVALID_REFERENCE")
        self.swap(body={"expected_event_updated_at": 1}, status=409, code="STALE_PROGRAM")
        self.request(f"activities/{self.a.pk}", "patch",
                     self.activity_body(self.a, expected_updated_at=1), status=409, code="STALE_ACTIVITY")
        self.request(f"activities/{self.a.pk}", "patch",
                     self.activity_body(self.a, expected_updated_at=milliseconds(self.a.updated_at)))
