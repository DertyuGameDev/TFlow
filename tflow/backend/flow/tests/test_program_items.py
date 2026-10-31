from datetime import timedelta

from django.test import TestCase, override_settings

from flow.models import Activity, Room, User
from flow.serializers import milliseconds
from .test_api import FAST_HASHER, Scenario


@override_settings(PASSWORD_HASHERS=FAST_HASHER)
class ProgramItemTests(Scenario, TestCase):
    def setUp(self):
        super().setUp()
        self.body = self.activity_body(self.a, capacity=10)
        self.body.pop("room_id")
        self.event.activities.all().delete()
        self.event.rooms.all().delete()
        self.path = f"events/{self.event.pk}/activities"

    def test_first_item_creates_main_room_and_next_item_reuses_it(self):
        first = self.request(self.path, "post", self.body, status=201)
        activity = Activity.objects.get(pk=first["id"])
        self.assertEqual(activity.room.name, "Основная площадка")
        self.assertEqual(activity.room.capacity, self.event.capacity)
        self.assertEqual(activity.starts_at, self.start)
        next_body = {
            **self.body,
            "title": "Следующая лекция",
            "starts_at": milliseconds(self.start + timedelta(hours=1)),
            "ends_at": milliseconds(self.start + timedelta(hours=2)),
        }
        second = self.request(self.path, "post", next_body, status=201)
        self.assertEqual(
            Activity.objects.get(pk=second["id"]).room_id, activity.room_id
        )
        self.assertEqual(self.event.rooms.count(), 1)

    def test_outside_event_rolls_back_automatic_room(self):
        self.request(
            self.path,
            "post",
            {**self.body, "starts_at": milliseconds(self.start - timedelta(minutes=1))},
            status=409,
            code="EVENT_DATES",
        )
        self.assertFalse(self.event.rooms.exists())
        self.assertFalse(self.event.activities.exists())

    def test_over_capacity_rolls_back_automatic_room(self):
        self.request(
            self.path,
            "post",
            {**self.body, "capacity": self.event.capacity + 1},
            status=409,
            code="ROOM_CAPACITY",
        )
        self.assertFalse(self.event.rooms.exists())

    def test_overlap_is_rejected_without_extra_room(self):
        self.request(self.path, "post", self.body, status=201)
        self.request(self.path, "post", self.body, status=409, code="ROOM_CONFLICT")
        self.assertEqual(self.event.rooms.count(), 1)
        self.assertEqual(self.event.activities.count(), 1)

    def test_multiple_rooms_require_explicit_choice(self):
        for name in ["Первый зал", "Второй зал"]:
            Room.objects.create(event=self.event, name=name, capacity=20)
        self.request(self.path, "post", self.body, status=400, code="VALIDATION")
        self.assertFalse(self.event.activities.exists())

    def test_edit_without_room_keeps_existing_choice(self):
        created = self.request(self.path, "post", self.body, status=201)
        before = Activity.objects.get(pk=created["id"])
        Room.objects.create(event=self.event, name="Другой зал", capacity=20)
        self.request(
            f"activities/{before.pk}",
            "patch",
            {**self.body, "title": "Изменённая лекция"},
        )
        before.refresh_from_db()
        self.assertEqual(before.title, "Изменённая лекция")
        self.assertEqual(before.room.name, "Основная площадка")

    def test_only_owner_can_create_program_and_automatic_room(self):
        for client in [self.participant, self.stranger]:
            self.request(
                self.path,
                "post",
                self.body,
                client=client,
                status=403,
                code="FORBIDDEN",
            )
        other_host = User.objects.create_user(
            "other-host@example.test",
            "test-password",
            name="Другой организатор",
            role="organizer",
        )
        self.stranger.force_login(other_host)
        self.request(
            self.path,
            "post",
            self.body,
            client=self.stranger,
            status=403,
            code="FORBIDDEN",
        )
        self.assertFalse(self.event.rooms.exists())

    def test_online_room_capacity_is_bounded(self):
        self.event.format = "Онлайн"
        self.event.capacity = 50000
        self.event.save()
        created = self.request(self.path, "post", self.body, status=201)
        room = Activity.objects.get(pk=created["id"]).room
        self.assertEqual(room.name, "Онлайн-комната")
        self.assertEqual(room.capacity, 10000)
