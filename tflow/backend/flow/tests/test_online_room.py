from .webinar_clock import freeze_webinar_clock
from datetime import timedelta
from unittest.mock import patch

from django.test import TestCase, override_settings

from flow.calendar import activity_item
from flow.models import Activity, EventRegistration, Room
from flow.serializers import milliseconds
from .test_api import FAST_HASHER, Scenario


@override_settings(
    PASSWORD_HASHERS=FAST_HASHER,
    LIVEKIT_URL="wss://video.example.test",
    LIVEKIT_API_KEY="test-key",
    LIVEKIT_API_SECRET="test-only-livekit-secret-at-least-32-bytes",
)
class OnlineRoomTests(Scenario, TestCase):
    def setUp(self):
        super().setUp()
        self.webinar_clock = freeze_webinar_clock(self, self.start)
        self.path = f"events/{self.event.pk}/activities"
        self.body = {**self.activity_body(self.a), "room_id": "", "online_room": True}

    def create_online(self, **changes):
        data = self.request(self.path, "post", {**self.body, **changes}, status=201)
        return Activity.objects.select_related("room", "event").get(pk=data["id"])

    def test_online_runs_alongside_physical_rooms_and_enables_hybrid_webinar(self):
        online = self.create_online(title="Онлайн-лекция")
        self.event.refresh_from_db()
        self.assertEqual(self.event.format, "Гибрид")
        self.assertEqual(self.event.venue, "Учебный центр")
        self.assertEqual(online.starts_at, self.a.starts_at)
        self.assertTrue(online.room.is_online)
        self.assertEqual(online.room.name, "Онлайн")
        self.assertEqual(self.event.rooms.filter(is_online=True).count(), 1)
        detail = self.request(f"events/{self.event.pk}")
        self.assertTrue(
            next(room for room in detail["rooms"] if room["id"] == online.room_id)[
                "is_online"
            ]
        )
        self.assertTrue(
            next(item for item in detail["activities"] if item["id"] == online.pk)[
                "room_is_online"
            ]
        )
        self.assertTrue(self.request(f"events/{self.event.pk}/webinar")["host"])

    def test_next_online_item_reuses_room_but_overlapping_streams_are_rejected(self):
        first = self.create_online()
        second = self.create_online(
            title="Следующий эфир",
            starts_at=milliseconds(self.start + timedelta(hours=1)),
            ends_at=milliseconds(self.start + timedelta(hours=2)),
        )
        self.assertEqual(first.room_id, second.room_id)
        self.request(self.path, "post", self.body, status=409, code="ROOM_CONFLICT")
        self.assertEqual(self.event.rooms.filter(is_online=True).count(), 1)

    def test_invalid_times_roll_back_room_and_format_change(self):
        self.request(
            self.path,
            "post",
            {**self.body, "starts_at": milliseconds(self.start - timedelta(minutes=1))},
            status=409,
            code="EVENT_DATES",
        )
        self.event.refresh_from_db()
        self.assertEqual(self.event.format, "Очно")
        self.assertFalse(self.event.rooms.filter(is_online=True).exists())

    def test_online_room_inherits_event_capacity_without_old_ceiling(self):
        self.event.capacity = 50000
        self.event.save(update_fields=["capacity"])
        online = self.create_online(capacity=40000)
        self.assertEqual(online.room.capacity, 50000)
        self.assertEqual(online.capacity, 40000)

    def test_editing_into_online_and_back_keeps_explicit_room_choice(self):
        self.request(f"activities/{self.a.pk}", "patch", self.body)
        self.a.refresh_from_db()
        self.assertTrue(self.a.room.is_online)
        self.request(
            f"activities/{self.a.pk}",
            "patch",
            self.activity_body(self.a, room_id=self.r1.pk, online_room=False),
        )
        self.a.refresh_from_db()
        self.assertEqual(self.a.room_id, self.r1.pk)

    def test_cannot_mark_physical_or_foreign_room_as_online(self):
        self.request(
            self.path,
            "post",
            {**self.body, "room_id": self.r1.pk},
            status=400,
            code="INVALID_REFERENCE",
        )
        other = Room.objects.create(
            event=self.event, name="Онлайн", is_online=True, capacity=50
        )
        foreign = self.event.__class__.objects.create(
            **{
                field: getattr(self.event, field)
                for field in [
                    "owner",
                    "title",
                    "description",
                    "starts_at",
                    "ends_at",
                    "city",
                    "venue",
                    "format",
                    "topic",
                    "kind",
                ]
            }
        )
        self.request(
            f"events/{foreign.pk}/activities",
            "post",
            {**self.body, "room_id": other.pk},
            status=400,
            code="INVALID_REFERENCE",
        )

    def test_only_owner_can_create_virtual_room(self):
        for client in [self.participant, self.stranger]:
            self.request(
                self.path,
                "post",
                self.body,
                client=client,
                status=403,
                code="FORBIDDEN",
            )
        self.assertFalse(self.event.rooms.filter(is_online=True).exists())

    def test_database_allows_multiple_online_rooms(self):
        self.create_online()
        Room.objects.create(event=self.event, name="Второй эфир", is_online=True, capacity=50)
        self.assertEqual(self.event.rooms.filter(is_online=True).count(), 2)

    def test_cannot_hide_online_program_by_switching_to_physical_format(self):
        self.create_online()
        self.request(
            f"events/{self.event.pk}",
            "patch",
            self.event_body(format="Очно"),
            status=409,
            code="ONLINE_PROGRAM",
        )
        self.event.refresh_from_db()
        self.assertEqual(self.event.format, "Гибрид")

    def test_online_calendar_and_personal_schedule_do_not_show_physical_address(self):
        online = self.create_online()
        self.publish()
        self.request(
            f"activities/{online.pk}/registration",
            "post",
            client=self.participant,
        )
        item = activity_item(online)
        self.assertEqual(item["location"], "Онлайн · ТФлоу")
        schedule = self.request("bootstrap", client=self.participant)["schedule"]
        self.assertEqual(schedule[0]["city"], "Онлайн")
        self.assertEqual(schedule[0]["venue"], "ТФлоу")
        self.assertTrue(schedule[0]["room_is_online"])

    @patch("flow.webinars.room_api", return_value={})
    def test_registered_viewer_can_join_hybrid_stream_without_publish_permissions(
        self, media
    ):
        online = self.create_online()
        self.request(
            f"rooms/{online.room_id}", "patch", {"name": "Онлайн", "capacity": 20}
        )
        self.publish()
        EventRegistration.objects.create(event=self.event, user=self.person)
        stream = f"events/{self.event.pk}/webinar"
        self.request(stream, "post", {"operation": "start"})
        self.assertEqual(media.call_args.kwargs["max_participants"], 21)
        viewer = self.request(
            stream, "post", {"operation": "join"}, client=self.participant
        )
        self.assertFalse(viewer["host"])
        self.assertTrue(viewer["token"])
