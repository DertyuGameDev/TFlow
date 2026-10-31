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

    def test_online_room_inherits_event_capacity_without_old_ceiling(self):
        self.event.format = "Онлайн"
        self.event.capacity = 50000
        self.event.save()
        created = self.request(self.path, "post", self.body, status=201)
        room = Activity.objects.get(pk=created["id"]).room
        self.assertEqual(room.name, "Онлайн-комната")
        self.assertEqual(room.capacity, 50000)

    def test_creates_named_room_and_item_together(self):
        result = self.request(
            self.path,
            "post",
            {
                **self.body,
                "new_room_name": "Зал практики",
                "new_room_capacity": 25,
            },
            status=201,
        )
        activity = Activity.objects.get(pk=result["id"])
        self.assertEqual(activity.room.name, "Зал практики")
        self.assertEqual(activity.room.capacity, 25)
        self.assertEqual(activity.room.event_id, self.event.pk)
        self.assertEqual(activity.capacity, 10)

    def test_named_room_creation_rolls_back_on_invalid_item(self):
        for changes, code in [
            ({"new_room_capacity": 9}, "ROOM_CAPACITY"),
            (
                {"starts_at": milliseconds(self.start - timedelta(minutes=1))},
                "EVENT_DATES",
            ),
        ]:
            with self.subTest(code=code):
                self.request(
                    self.path,
                    "post",
                    {
                        **self.body,
                        "new_room_name": "Новый зал",
                        "new_room_capacity": 25,
                        **changes,
                    },
                    status=409,
                    code=code,
                )
                self.assertFalse(self.event.rooms.exists())
                self.assertFalse(self.event.activities.exists())

    def test_cannot_combine_existing_room_and_new_room_or_omit_name(self):
        room = Room.objects.create(event=self.event, name="Зал", capacity=20)
        for changes in [
            {"room_id": room.pk, "new_room_name": "Новый зал"},
            {"new_room_capacity": 25},
            {"new_room_name": "Новый зал", "new_room_capacity": 0},
        ]:
            with self.subTest(changes=changes):
                self.request(self.path, "post", {**self.body, **changes}, status=400)
        self.assertEqual(self.event.rooms.count(), 1)
        self.assertFalse(self.event.activities.exists())

    def test_new_room_defaults_to_item_capacity_and_is_available_for_next_item(self):
        result = self.request(
            self.path, "post", {**self.body, "new_room_name": "Практика"}, status=201
        )
        room = Activity.objects.get(pk=result["id"]).room
        self.assertEqual(room.capacity, self.body["capacity"])
        detail = self.request(f"events/{self.event.pk}")
        self.assertEqual(detail["rooms"][0]["id"], room.pk)

    def test_edit_can_move_item_into_new_room_without_changing_original_room(self):
        result = self.request(self.path, "post", self.body, status=201)
        original = Activity.objects.get(pk=result["id"]).room
        self.request(
            f"activities/{result['id']}",
            "patch",
            {
                **self.body,
                "new_room_name": "Новая практика",
                "new_room_capacity": 30,
            },
        )
        activity = Activity.objects.get(pk=result["id"])
        self.assertNotEqual(activity.room_id, original.pk)
        self.assertEqual(activity.room.name, "Новая практика")
        self.assertTrue(Room.objects.filter(pk=original.pk).exists())

    def test_unauthorized_inline_creation_does_not_leave_room(self):
        self.request(
            self.path,
            "post",
            {**self.body, "new_room_name": "Чужой зал"},
            client=self.participant,
            status=403,
        )
        self.assertFalse(self.event.rooms.exists())

    def test_named_rooms_and_single_online_room_can_coexist_in_same_time_slot(self):
        first = self.request(
            self.path, "post", {**self.body, "new_room_name": "Практика"}, status=201
        )
        online = self.request(
            self.path, "post", {**self.body, "online_room": True}, status=201
        )
        second = self.request(
            self.path, "post", {**self.body, "new_room_name": "Обсуждение"}, status=201
        )
        self.assertFalse(Activity.objects.get(pk=first["id"]).room.is_online)
        self.assertTrue(Activity.objects.get(pk=online["id"]).room.is_online)
        self.assertFalse(Activity.objects.get(pk=second["id"]).room.is_online)
        self.assertEqual(self.event.rooms.filter(is_online=True).count(), 1)
        self.assertEqual(self.event.rooms.count(), 3)
        self.event.refresh_from_db()
        self.assertEqual(self.event.format, "Гибрид")

    def test_named_online_stream_is_created_together_with_activity(self):
        result = self.request(
            self.path,
            "post",
            {
                **self.body,
                "new_room_name": "Новый зал",
                "online_room": True,
            },
            status=201,
        )
        activity = Activity.objects.select_related("room").get(pk=result["id"])
        self.assertTrue(activity.room.is_online)
        self.assertEqual(activity.room.name, "Новый зал")
