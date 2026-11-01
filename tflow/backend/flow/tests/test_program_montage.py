from datetime import timedelta

from django.test import TestCase, override_settings

from flow.models import (
    Activity,
    HttpBroadcast,
    Registration,
    WaitlistEntry,
)
from flow.serializers import milliseconds

from .test_api import FAST_HASHER, Scenario


@override_settings(PASSWORD_HASHERS=FAST_HASHER)
class ProgramMontageTests(Scenario, TestCase):
    def setUp(self):
        super().setUp()
        self.c.delete()
        self.d.delete()
        self.b.starts_at = self.start + timedelta(hours=1)
        self.b.ends_at = self.start + timedelta(hours=2)
        self.b.save()
        self.path = f"events/{self.event.pk}/program-edit"

    def edit(self, operation, **data):
        self.event.refresh_from_db()
        return self.request(
            self.path,
            "post",
            {
                "operation": operation,
                "activity_id": self.a.pk,
                "expected_event_updated_at": milliseconds(self.event.updated_at),
                **data,
            },
        )

    def test_move_keeps_identity_registrations_and_signed_undo_restores_time(self):
        Registration.objects.create(user=self.person, activity=self.a)
        original = self.a.starts_at
        result = self.edit(
            "move",
            starts_at=milliseconds(original + timedelta(hours=2)),
            ends_at=milliseconds(self.a.ends_at + timedelta(hours=2)),
        )
        self.a.refresh_from_db()
        self.assertNotEqual(original, self.a.starts_at)
        self.assertEqual(self.a.registrations.count(), 1)
        self.edit("undo", undo=result["undo"])
        self.a.refresh_from_db()
        self.assertEqual(original, self.a.starts_at)

    def test_split_preserves_existing_signups_and_queue_without_attendance_fabrication(
        self,
    ):
        Registration.objects.create(user=self.person, activity=self.a)
        WaitlistEntry.objects.create(user=self.other, activity=self.a)
        at = self.a.starts_at + timedelta(minutes=20)
        end = self.a.ends_at
        result = self.edit("split", at=milliseconds(at))
        second = Activity.objects.get(pk=result["created_ids"][0])
        self.a.refresh_from_db()
        self.assertEqual(self.a.ends_at, at)
        self.assertEqual(second.starts_at, at)
        self.assertEqual(second.ends_at, end)
        self.assertEqual(
            set(second.registrations.values_list("user_id", flat=True)),
            {self.person.pk},
        )
        self.assertEqual(second.waitlist.count(), 1)
        self.assertEqual(second.attendance.count(), 0)
        self.edit("undo", undo=result["undo"])
        self.assertFalse(Activity.objects.filter(pk=second.pk).exists())
        self.assertEqual(self.a.registrations.count(), 1)

    def test_undo_never_erases_new_participant_data_and_checks_program_state(self):
        result = self.edit(
            "split", at=milliseconds(self.a.starts_at + timedelta(minutes=20))
        )
        second = Activity.objects.get(pk=result["created_ids"][0])
        Registration.objects.create(user=self.person, activity=second)
        self.event.refresh_from_db()
        self.request(
            self.path,
            "post",
            {
                "operation": "undo",
                "undo": result["undo"],
                "expected_event_updated_at": milliseconds(self.event.updated_at),
            },
            status=409,
            code="UNDO_HAS_DATA",
        )
        self.assertTrue(second.registrations.exists())

    def test_insert_inside_splits_target_and_preserves_durations(self):
        self.b.room = self.r1
        self.b.save()
        old_duration = self.a.ends_at - self.a.starts_at
        at = self.b.starts_at + timedelta(minutes=10)
        result = self.edit(
            "insert", target_id=self.b.pk, position="inside", at=milliseconds(at)
        )
        self.a.refresh_from_db()
        self.b.refresh_from_db()
        tail = Activity.objects.get(pk=result["created_ids"][0])
        self.assertEqual(self.a.ends_at - self.a.starts_at, old_duration)
        self.assertEqual(self.b.ends_at, self.a.starts_at)
        self.assertEqual(tail.starts_at, self.a.ends_at)
        self.edit("undo", undo=result["undo"])
        self.a.refresh_from_db()
        self.b.refresh_from_db()
        self.assertEqual(self.a.starts_at, self.start)

    def test_conflict_stale_permissions_active_webinar_and_invalid_split_roll_back(
        self,
    ):
        self.event.refresh_from_db()
        base = {
            "operation": "split",
            "activity_id": self.a.pk,
            "at": milliseconds(self.a.starts_at + timedelta(minutes=10)),
            "expected_event_updated_at": milliseconds(self.event.updated_at),
        }
        self.request(self.path, "post", base, client=self.participant, status=403)
        self.request(
            self.path, "post", {**base, "expected_event_updated_at": 1}, status=409
        )
        self.request(
            self.path,
            "post",
            {**base, "at": milliseconds(self.a.starts_at)},
            status=409,
        )
        HttpBroadcast.objects.create(event=self.event, activity=self.a, active=True)
        self.request(self.path, "post", base, status=409, code="WEBINAR_ACTIVE")
        self.assertEqual(self.event.activities.count(), 2)

    def test_copy_starts_with_empty_registration_and_invalid_undo_cannot_change_data(
        self,
    ):
        Registration.objects.create(user=self.person, activity=self.a)
        result = self.edit("copy", at=milliseconds(self.a.ends_at), room_id=self.r1.pk)
        copy = Activity.objects.get(pk=result["created_ids"][0])
        self.assertEqual(copy.registrations.count(), 0)
        self.event.refresh_from_db()
        self.request(
            self.path,
            "post",
            {
                "operation": "undo",
                "undo": result["undo"] + "x",
                "expected_event_updated_at": milliseconds(self.event.updated_at),
            },
            status=409,
        )
        self.assertTrue(Activity.objects.filter(pk=copy.pk).exists())

    def test_two_undos_work_in_order_without_overwriting_new_changes(self):
        one = self.edit(
            "move",
            starts_at=milliseconds(self.start + timedelta(hours=3)),
            ends_at=milliseconds(self.start + timedelta(hours=4)),
        )
        two = self.edit(
            "move",
            starts_at=milliseconds(self.start + timedelta(hours=4)),
            ends_at=milliseconds(self.start + timedelta(hours=5)),
        )
        self.edit("undo", undo=two["undo"])
        self.a.refresh_from_db()
        self.assertEqual(self.a.starts_at, self.start + timedelta(hours=3))
        self.edit("undo", undo=one["undo"])
        self.a.refresh_from_db()
        self.assertEqual(self.a.starts_at, self.start)

    def test_out_of_bounds_insert_rolls_back_every_shift_and_notification(self):
        from flow.models import Notification

        self.publish()
        self.b.starts_at = self.start + timedelta(hours=8)
        self.b.ends_at = self.start + timedelta(hours=9)
        self.b.save()
        before = list(
            self.event.activities.order_by("id").values("id", "starts_at", "ends_at")
        )
        count = Notification.objects.count()
        self.event.refresh_from_db()
        self.request(
            self.path,
            "post",
            {
                "operation": "insert",
                "activity_id": self.a.pk,
                "target_id": self.b.pk,
                "position": "before",
                "expected_event_updated_at": milliseconds(self.event.updated_at),
            },
            status=409,
            code="EVENT_DATES",
        )
        self.assertEqual(
            before,
            list(
                self.event.activities.order_by("id").values(
                    "id", "starts_at", "ends_at"
                )
            ),
        )
        self.assertEqual(Notification.objects.count(), count)

    def test_participant_overlap_rejects_all_program_changes(self):
        room = type(self.r1).objects.create(
            event=self.event, name="Третий зал", capacity=2
        )
        third = Activity.objects.create(
            event=self.event,
            room=room,
            title="Личная запись",
            capacity=2,
            starts_at=self.start + timedelta(minutes=90),
            ends_at=self.start + timedelta(minutes=150),
        )
        for item in [self.a, third]:
            Registration.objects.create(user=self.person, activity=item)
        self.event.refresh_from_db()
        self.request(
            self.path,
            "post",
            {
                "operation": "insert",
                "activity_id": self.a.pk,
                "target_id": self.b.pk,
                "position": "before",
                "expected_event_updated_at": milliseconds(self.event.updated_at),
            },
            status=409,
            code="ENROLLED_CONFLICT",
        )
        self.a.refresh_from_db()
        self.assertEqual(self.a.starts_at, self.start)

    def test_duplicate_can_be_inserted_after_itself_without_copying_registrations(self):
        Registration.objects.create(user=self.person, activity=self.a)
        result = self.edit("copy", target_id=self.a.pk, position="after")
        duplicate = Activity.objects.get(pk=result["created_ids"][0])
        self.a.refresh_from_db()
        self.assertEqual(duplicate.starts_at, self.a.ends_at)
        self.assertFalse(duplicate.registrations.exists())
        self.edit("undo", undo=result["undo"])
