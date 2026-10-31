"""Exercise the real webinar service, replacing only the HTTP transport."""
import json
from io import BytesIO
from io import StringIO
from urllib.error import HTTPError, URLError
from unittest.mock import patch

import jwt
from django.test import SimpleTestCase, TestCase, override_settings
from django.utils import timezone
from django.core.management import call_command, CommandError

from flow.contracts import FlowError
from flow.models import Event, EventRegistration, Notification, Registration, Webinar
from flow.webinars import room_api
from .test_api import FAST_HASHER, Scenario
from .test_clubs_webinars import VIDEO_SECRET

VIDEO = {
    "LIVEKIT_URL": "wss://video.example.test/",
    "LIVEKIT_API_KEY": "test-key",
    "LIVEKIT_API_SECRET": VIDEO_SECRET,
}


def response(body=b"{}"):
    return BytesIO(body)


@override_settings(**VIDEO)
class WebinarTransportTests(SimpleTestCase):
    @override_settings(LIVEKIT_API_URL="http://127.0.0.1:7880")
    @patch("flow.webinars.urlopen")
    def test_vm_uses_private_api_without_exposing_it_to_browser(self, transport):
        transport.return_value = response()
        room_api("CreateRoom", "vm-room")
        self.assertEqual(transport.call_args.args[0].full_url, "http://127.0.0.1:7880/twirp/livekit.RoomService/CreateRoom")

    @patch("flow.webinars.urlopen")
    def test_diagnostic_checks_credentials_without_creating_rooms(self, transport):
        transport.return_value = response(b'{"rooms":[]}')
        output = StringIO()
        call_command("check_webinars", stdout=output)
        request = transport.call_args.args[0]
        self.assertTrue(request.full_url.endswith("/ListRooms"))
        self.assertEqual(json.loads(request.data), {})
        claims = jwt.decode(request.get_header("Authorization").removeprefix("Bearer "), VIDEO_SECRET, algorithms=["HS256"])
        self.assertTrue(claims["video"]["roomList"])
        self.assertNotIn("roomAdmin", claims["video"])
        self.assertIn("ключи приняты", output.getvalue())
        self.assertNotIn(VIDEO_SECRET, output.getvalue())

    @override_settings(LIVEKIT_API_KEY="")
    @patch("flow.webinars.urlopen")
    def test_diagnostic_explains_missing_configuration(self, transport):
        with self.assertRaisesMessage(CommandError, "не настроены"):
            call_command("check_webinars")
        transport.assert_not_called()

    @override_settings(DEBUG=False, LIVEKIT_URL="ws://127.0.0.1:7880")
    @patch("flow.webinars.urlopen")
    def test_production_cannot_advertise_local_development_url(self, transport):
        with self.assertRaisesMessage(CommandError, "публичный WSS"):
            call_command("check_webinars")
        transport.assert_not_called()

    @patch("flow.webinars.urlopen")
    def test_create_room_sends_signed_server_grant_and_capacity(self, transport):
        transport.return_value = response(b'{"name":"test-room"}')
        result = room_api("CreateRoom", "test-room", max_participants=12)
        self.assertEqual(result, {"name": "test-room"})
        request = transport.call_args.args[0]
        self.assertEqual(request.full_url, "https://video.example.test/twirp/livekit.RoomService/CreateRoom")
        self.assertEqual(request.method, "POST")
        self.assertEqual(json.loads(request.data), {"name": "test-room", "max_participants": 12})
        self.assertEqual(request.get_header("Content-type"), "application/json")
        claims = jwt.decode(request.get_header("Authorization").removeprefix("Bearer "),
                            VIDEO_SECRET, algorithms=["HS256"], issuer="test-key")
        self.assertEqual(claims["sub"], "tflow-server")
        self.assertEqual(claims["video"]["room"], "test-room")
        self.assertTrue(claims["video"]["roomAdmin"])
        self.assertTrue(claims["video"]["roomCreate"])
        self.assertLessEqual(claims["exp"] - claims["nbf"], 305)
        self.assertEqual(transport.call_args.kwargs["timeout"], 5)

    @override_settings(LIVEKIT_URL="ws://127.0.0.1:7880/")
    @patch("flow.webinars.urlopen")
    def test_remove_participant_uses_http_room_and_identity(self, transport):
        transport.return_value = response()
        room_api("RemoveParticipant", "session-one", identity="viewer-one")
        request = transport.call_args.args[0]
        self.assertEqual(request.full_url, "http://127.0.0.1:7880/twirp/livekit.RoomService/RemoveParticipant")
        self.assertEqual(json.loads(request.data), {"room": "session-one", "identity": "viewer-one"})

    def test_already_missing_room_or_viewer_is_an_idempotent_cleanup(self):
        for method in ["DeleteRoom", "RemoveParticipant"]:
            with self.subTest(method=method), patch("flow.webinars.urlopen", side_effect=HTTPError(
                "https://video.example.test", 404, "missing", {}, None
            )):
                self.assertEqual(room_api(method, "missing-room"), {})

    def test_http_errors_do_not_report_success_or_reveal_response_body(self):
        for status in [401, 403, 404, 429, 500, 503]:
            with self.subTest(status=status), patch("flow.webinars.urlopen", side_effect=HTTPError(
                "https://video.example.test/private", status, "secret provider detail", {}, BytesIO(b"private detail")
            )), self.assertRaises(FlowError) as caught:
                room_api("CreateRoom", "test-room")
            self.assertEqual(caught.exception.code, "VIDEO_UNAVAILABLE")
            self.assertEqual(caught.exception.status, 503)
            self.assertNotIn("private", str(caught.exception))
            self.assertNotIn(VIDEO_SECRET, str(caught.exception))

    def test_network_timeout_and_unreadable_json_are_recoverable_errors(self):
        for error in [URLError("private address"), TimeoutError(), OSError("private path")]:
            with self.subTest(error=type(error).__name__), patch("flow.webinars.urlopen", side_effect=error), self.assertRaises(FlowError) as caught:
                room_api("CreateRoom", "test-room")
            self.assertEqual((caught.exception.code, caught.exception.status), ("VIDEO_UNAVAILABLE", 503))
        with patch("flow.webinars.urlopen", return_value=response(b"not-json")), self.assertRaises(FlowError) as caught:
            room_api("CreateRoom", "test-room")
        self.assertEqual(caught.exception.status, 503)


@override_settings(PASSWORD_HASHERS=FAST_HASHER, **VIDEO)
class WebinarFailureRecoveryTests(Scenario, TestCase):
    def setUp(self):
        super().setUp()
        self.event.format = "Онлайн"
        self.event.status = "published"
        self.event.save()
        EventRegistration.objects.create(user=self.person, event=self.event)
        Registration.objects.create(user=self.person, activity=self.a)
        self.webinar = Webinar.objects.create(event=self.event, active=True, started_at=timezone.now())
        self.path = f"events/{self.event.pk}/webinar"

    @patch("flow.webinars.urlopen")
    def test_failed_end_keeps_session_active_and_retry_can_finish(self, transport):
        transport.side_effect = URLError("offline")
        self.request(self.path, "post", {"operation": "end"}, status=503, code="VIDEO_UNAVAILABLE")
        self.webinar.refresh_from_db()
        self.assertTrue(self.webinar.active)
        self.assertIsNone(self.webinar.ended_at)
        old_room = self.webinar.room
        transport.side_effect = None
        transport.return_value = response()
        self.request(self.path, "post", {"operation": "end"})
        self.webinar.refresh_from_db()
        self.assertFalse(self.webinar.active)
        self.assertIsNotNone(self.webinar.ended_at)
        self.assertEqual(self.webinar.room, old_room)

    @patch("flow.webinars.urlopen")
    def test_failed_media_cleanup_does_not_delete_event_or_tickets(self, transport):
        transport.side_effect = TimeoutError()
        self.request(f"events/{self.event.pk}", "delete", status=503, code="VIDEO_UNAVAILABLE")
        self.assertTrue(Event.objects.filter(pk=self.event.pk).exists())
        self.assertTrue(EventRegistration.objects.filter(event=self.event, user=self.person).exists())
        self.assertTrue(Registration.objects.filter(activity=self.a, user=self.person).exists())
        self.assertFalse(Notification.objects.exists())
        transport.side_effect = None
        transport.return_value = response()
        self.request(f"events/{self.event.pk}", "delete")
        self.assertFalse(Event.objects.filter(pk=self.event.pk).exists())
        self.assertEqual(Notification.objects.filter(user=self.person, kind="event_cancelled").count(), 1)

    @patch("flow.webinars.urlopen", side_effect=URLError("offline"))
    def test_ticket_cancellation_still_revokes_access_during_media_outage(self, transport):
        self.request(f"events/{self.event.pk}/registration", "delete", client=self.participant)
        self.assertFalse(EventRegistration.objects.filter(user=self.person).exists())
        self.assertFalse(Registration.objects.filter(user=self.person).exists())
        self.request(self.path, "post", {"operation": "join"}, client=self.participant,
                     status=403, code="NOT_REGISTERED")
        self.webinar.refresh_from_db()
        self.assertTrue(self.webinar.active)

    def test_live_webinar_cannot_silently_become_physical_event(self):
        self.request(f"events/{self.event.pk}", "patch", self.event_body(format="Очно"),
                     status=409, code="WEBINAR_ACTIVE")
        self.event.refresh_from_db()
        self.assertEqual(self.event.format, "Онлайн")
        self.assertFalse(Notification.objects.exists())

    @patch("flow.webinars.urlopen")
    def test_ending_before_changing_to_physical_preserves_ticket(self, transport):
        transport.return_value = response()
        self.request(self.path, "post", {"operation": "end"})
        self.request(f"events/{self.event.pk}", "patch", self.event_body(format="Очно"))
        self.event.refresh_from_db()
        self.assertEqual(self.event.format, "Очно")
        self.assertTrue(EventRegistration.objects.filter(event=self.event, user=self.person).exists())
        self.request(self.path, client=self.participant, status=400, code="NOT_WEBINAR")

    @patch("flow.webinars.urlopen")
    def test_unknown_operation_does_not_touch_running_room(self, transport):
        self.request(self.path, "post", {"operation": "restart"}, status=400, code="VALIDATION")
        transport.assert_not_called()
        self.webinar.refresh_from_db()
        self.assertTrue(self.webinar.active)
