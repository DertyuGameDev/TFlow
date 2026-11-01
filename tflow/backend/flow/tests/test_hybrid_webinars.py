"""Hybrid programme: physical sessions and native online flows share an event."""
from datetime import timedelta
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

import jwt
from django.test import TestCase, override_settings

from flow.models import Activity, ActivityAttendance, CheckIn, HttpBroadcast, Registration, Webinar
from flow.serializers import milliseconds
from .test_api import FAST_HASHER, Scenario
from .test_webinar_transport import VIDEO
from .webinar_clock import freeze_webinar_clock


@override_settings(PASSWORD_HASHERS=FAST_HASHER, **VIDEO)
@patch("flow.webinars.room_api", return_value={})
class HybridWebinarTests(Scenario, TestCase):
    def setUp(self):
        super().setUp()
        self.webinar_clock = freeze_webinar_clock(self, self.start + timedelta(minutes=1))
        self.event.format = "Гибрид"
        self.event.save(update_fields=["format"])
        self.publish()
        self.request(f"events/{self.event.pk}/registration", "post", client=self.participant)

    def create_online_flow(self, **overrides):
        result = self.request(f"events/{self.event.pk}/activities", "post", self.activity_body(
            self.a, title="Онлайн-флоу", room_id="", online_room=True,
            new_room_name="Онлайн-поток 1", new_room_capacity=self.event.capacity,
            **overrides,
        ), status=201)
        return Activity.objects.select_related("room").get(pk=result["id"])

    def test_create_online_flow_preserves_physical_venue_and_programme(self, media):
        flow = self.create_online_flow()
        self.event.refresh_from_db()
        self.a.refresh_from_db()
        self.assertEqual(self.event.format, "Гибрид")
        self.assertEqual((self.event.city, self.event.venue), ("Мурманск", "Учебный центр"))
        self.assertEqual(self.a.room_id, self.r1.pk)
        self.assertFalse(self.a.room.is_online)
        self.assertTrue(flow.room.is_online)
        self.assertNotEqual(flow.room_id, self.r1.pk)
        detail = self.request(f"events/{self.event.pk}")
        online = [item for item in detail["activities"] if item["room_is_online"]]
        self.assertEqual([item["id"] for item in online], [flow.pk])
        self.assertEqual(next(room for room in detail["rooms"] if room["id"] == flow.room_id)["is_online"], True)

    def test_required_flow_start_join_confirmation_and_finish(self, media):
        flow = self.create_online_flow()
        path = f"activities/{flow.pk}/webinar"
        self.request(path, client=self.participant, status=403, code="NOT_REGISTERED")
        self.request(f"activities/{flow.pk}/registration", "post", client=self.participant)
        host = self.request(path, "post", {"operation": "start"})
        viewer = self.request(path, "post", {"operation": "join"}, client=self.participant)
        self.assertEqual(host["session"], viewer["session"])
        claims = jwt.decode(viewer["token"], VIDEO["LIVEKIT_API_SECRET"], algorithms=["HS256"])
        self.assertEqual(claims["video"]["room"], "tflow-" + host["session"])
        self.assertFalse(claims["video"]["canPublish"])
        self.assertEqual(media.call_args.kwargs["max_participants"], flow.capacity + 1)
        media.return_value = {"identity": self.person.pk, "state": "ACTIVE"}
        self.request(path, "post", {"operation": "confirm", "session": viewer["session"]}, client=self.participant)
        self.assertTrue(ActivityAttendance.objects.filter(user=self.person, activity=flow, source="webinar").exists())
        self.assertTrue(CheckIn.objects.filter(user=self.person, event=self.event, source="webinar").exists())
        self.request(path, "post", {"operation": "end"})
        self.assertFalse(self.request(path)["active"])

    def test_open_flow_accepts_ticket_without_calendar_registration(self, media):
        flow = self.create_online_flow(registration_required=False)
        path = f"activities/{flow.pk}/webinar"
        self.request(path, "post", {"operation": "start"})
        self.assertFalse(self.request(path, client=self.participant)["host"])
        self.assertFalse(self.request(path, "post", {"operation": "join"}, client=self.participant)["host"])
        self.assertFalse(Registration.objects.filter(user=self.person, activity=flow).exists())
        self.request(path, "post", {"operation": "join"}, client=self.stranger, status=403, code="NOT_REGISTERED")

    def test_existing_physical_flow_can_move_to_new_online_room(self, media):
        self.request(f"activities/{self.a.pk}", "patch", self.activity_body(
            self.a, room_id="", online_room=True, new_room_name="Онлайн", new_room_capacity=self.event.capacity,
        ))
        self.a.refresh_from_db()
        self.assertTrue(self.a.room.is_online)
        self.assertTrue(self.event.rooms.filter(pk=self.r1.pk, is_online=False).exists())
        self.assertTrue(self.event.activities.filter(pk=self.c.pk, room=self.r1).exists())
        self.request(f"activities/{self.a.pk}/webinar", "post", {"operation": "start"})
        self.assertTrue(Webinar.objects.get(activity=self.a).active)

    def test_general_webinar_still_works_without_online_flows(self, media):
        self.assertFalse(self.event.activities.filter(room__is_online=True).exists())
        path = f"events/{self.event.pk}/webinar"
        host = self.request(path, "post", {"operation": "start"})
        viewer = self.request(path, "post", {"operation": "join"}, client=self.participant)
        self.assertEqual(viewer["session"], host["session"])
        self.request(f"activities/{self.a.pk}/webinar", "post", {"operation": "start"}, status=400, code="NOT_WEBINAR")

    def test_hybrid_flow_cannot_start_before_its_own_scheduled_time(self, media):
        starts_at = self.start + timedelta(minutes=30)
        flow = self.create_online_flow(starts_at=milliseconds(starts_at))
        path = f"activities/{flow.pk}/webinar"
        self.webinar_clock.now.return_value = starts_at - timedelta(microseconds=1)
        state = self.request(path)
        self.assertTrue(state["scheduled"])
        self.assertFalse(state["can_start"])
        self.assertEqual(state["starts_at"], starts_at.isoformat())
        self.request(path, "post", {"operation": "start"}, status=409, code="WEBINAR_TOO_EARLY")
        media.assert_not_called()
        self.assertFalse(Webinar.objects.filter(activity=flow).exists())
        self.webinar_clock.now.return_value = starts_at
        self.assertTrue(self.request(path)["can_start"])
        self.request(path, "post", {"operation": "start"})
        self.assertTrue(Webinar.objects.get(activity=flow).active)

    @override_settings(HTTP_BROADCAST_ENABLED=True)
    def test_hybrid_https_flow_cannot_start_or_resume_early(self, media):
        flow = self.create_online_flow()
        path = f"activities/{flow.pk}/broadcast"
        self.webinar_clock.now.return_value = flow.starts_at - timedelta(microseconds=1)
        with TemporaryDirectory() as directory, override_settings(HTTP_BROADCAST_ROOT=Path(directory)):
            (Path(directory) / "worker").touch()
            for operation in ["start", "resume"]:
                with self.subTest(operation=operation):
                    self.request(path, "post", {"operation": operation, "mime": "video/webm"}, status=409, code="WEBINAR_TOO_EARLY")
            self.assertFalse(HttpBroadcast.objects.filter(activity=flow).exists())
            self.webinar_clock.now.return_value = flow.starts_at
            self.request(path, "post", {"operation": "start", "mime": "video/webm"})
            self.assertTrue(HttpBroadcast.objects.get(activity=flow).active)
        media.assert_not_called()
