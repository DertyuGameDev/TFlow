from unittest.mock import patch
from urllib.error import HTTPError

from django.test import TestCase, override_settings
from django.utils import timezone

from flow.models import CheckIn, EventRegistration, Webinar
from .test_api import FAST_HASHER, Scenario
from .test_webinar_transport import VIDEO


@override_settings(PASSWORD_HASHERS=FAST_HASHER, **VIDEO)
class WebinarAttendanceTests(Scenario, TestCase):
    def setUp(self):
        super().setUp()
        self.event.format = "Онлайн"
        self.publish()
        self.event.save()
        EventRegistration.objects.create(user=self.person, event=self.event)
        self.webinar = Webinar.objects.create(event=self.event, active=True, started_at=timezone.now())
        self.path = f"events/{self.event.pk}/webinar"

    def confirm(self, **options):
        return self.request(self.path, "post", {"operation": "confirm", "session": str(self.webinar.room)},
                            client=options.pop("client", self.participant), **options)

    @patch("flow.webinars.room_api")
    def test_tokens_do_not_count_but_server_verified_connection_does_idempotently(self, server):
        self.request(self.path, "post", {"operation": "join"}, client=self.participant)
        self.assertFalse(CheckIn.objects.exists())
        server.assert_not_called()
        server.return_value = {"identity": self.person.pk, "state": "ACTIVE"}
        self.confirm(); self.confirm()
        entry = CheckIn.objects.get()
        self.assertEqual(entry.source, "webinar")
        self.assertIsNone(entry.checked_by)
        self.assertEqual(entry.user_id, self.person.pk)
        self.assertEqual(server.call_args.args[0], "GetParticipant")
        bootstrap = self.request("bootstrap", client=self.participant)
        self.assertEqual(bootstrap["events"][0]["checked_in"], 1)

    @patch("flow.webinars.room_api")
    def test_no_false_attendance_for_wrong_identity_state_or_old_session(self, server):
        for payload in [{"identity": self.other.pk, "state": "ACTIVE"},
                        {"identity": self.person.pk, "state": "JOINING"},
                        {"identity": self.person.pk, "state": "DISCONNECTED"}, {}]:
            with self.subTest(payload=payload):
                server.return_value = payload
                self.confirm(status=409, code="ATTENDANCE_UNCONFIRMED")
        self.request(self.path, "post", {"operation": "confirm", "session": "old"},
                     client=self.participant, status=409, code="STALE_WEBINAR")
        self.assertFalse(CheckIn.objects.exists())

    @patch("flow.webinars.urlopen", side_effect=HTTPError("https://video.example.test", 404, "missing", {}, None))
    def test_actual_server_missing_participant_is_not_confirmed(self, transport):
        self.confirm(status=409, code="ATTENDANCE_UNCONFIRMED")
        self.assertFalse(CheckIn.objects.exists())

    @patch("flow.webinars.room_api")
    def test_unregistered_and_host_do_not_count_as_attendees(self, server):
        self.confirm(client=self.stranger, status=403, code="NOT_REGISTERED")
        self.confirm(client=self.client, status=403, code="FORBIDDEN")
        server.assert_not_called()
        self.assertFalse(CheckIn.objects.exists())

    @patch("flow.webinars.room_api")
    def test_existing_qr_attendance_is_preserved(self, server):
        entry = CheckIn.objects.create(user=self.person, event=self.event, checked_by=self.owner)
        server.return_value = {"identity": self.person.pk, "state": 2}
        self.confirm()
        entry.refresh_from_db()
        self.assertEqual((entry.source, entry.checked_by_id), ("qr", self.owner.pk))
