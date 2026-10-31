from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from email.message import Message
from io import BytesIO
from threading import Barrier
from unittest.mock import Mock, patch
from urllib.request import HTTPSHandler, build_opener
from urllib.response import addinfourl

from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.files.uploadhandler import StopUpload
from django.db import OperationalError, close_old_connections, connections
from django.test import (
    Client,
    RequestFactory,
    SimpleTestCase,
    TestCase,
    TransactionTestCase,
    override_settings,
)
from django.utils import timezone

from flow.contracts import FlowError
from flow.models import (
    AuthRateLimit,
    CheckIn,
    Event,
    EventRegistration,
    Notification,
    User,
    UserAvatar,
)
from flow.security import (
    AvatarUploadLimitHandler,
    RequestLimitsMiddleware,
    client_address,
)
from flow.serializers import milliseconds
from flow.webinars import configured, room_api, signed_token
from .test_api import FAST_HASHER, Scenario
from .test_avatar import photo


@override_settings(PASSWORD_HASHERS=FAST_HASHER, AUTH_TRUSTED_PROXY_IPS=[])
class AuthenticationLimitTests(TestCase):
    def setUp(self):
        self.person = User.objects.create_user(
            "limited@example.test", "Test-password-42!", name="Участник"
        )

    def login(self, email="limited@example.test", password="wrong", **headers):
        return Client().post(
            "/login/", {"username": email, "password": password}, **headers
        )

    def test_repeated_guesses_are_blocked_before_password_verification(self):
        for index in range(10):
            email = "  LIMITED@EXAMPLE.TEST  " if index % 2 else self.person.email
            self.assertEqual(self.login(email).status_code, 200)
        with patch("django.contrib.auth.forms.authenticate") as authenticate:
            response = self.login(password="Test-password-42!")
        self.assertEqual(response.status_code, 429)
        self.assertGreater(int(response["Retry-After"]), 0)
        self.assertIn("no-store", response["Cache-Control"])
        authenticate.assert_not_called()
        self.assertNotIn(self.person.email, response.content.decode())

    def test_expired_budget_allows_correct_password_and_is_cleaned(self):
        for _ in range(10):
            self.login()
        AuthRateLimit.objects.update(expires_at=timezone.now() - timedelta(seconds=1))
        client = Client()
        response = client.post(
            "/login/", {"username": self.person.email, "password": "Test-password-42!"}
        )
        self.assertEqual(response.status_code, 302)
        self.assertEqual(
            client.get("/api/auth/me").json()["user"]["userId"], self.person.pk
        )
        self.assertEqual(AuthRateLimit.objects.count(), 2)
        self.assertTrue(all(row.attempts == 1 for row in AuthRateLimit.objects.all()))

    def test_untrusted_forwarded_headers_cannot_reset_the_budget(self):
        for index in range(10):
            self.assertEqual(
                self.login(HTTP_X_FORWARDED_FOR=f"198.51.100.{index}").status_code, 200
            )
        self.assertEqual(
            self.login(HTTP_X_FORWARDED_FOR="203.0.113.99").status_code, 429
        )
        for key in AuthRateLimit.objects.values_list("key", flat=True):
            self.assertRegex(key, r"^[0-9a-f]{64}$")
            self.assertNotIn(self.person.email, key)

    @override_settings(AUTH_LOGIN_IP_LIMIT=2)
    def test_password_spraying_across_accounts_is_also_limited(self):
        self.assertEqual(self.login("first@example.test").status_code, 200)
        self.assertEqual(self.login("second@example.test").status_code, 200)
        self.assertEqual(self.login("third@example.test").status_code, 429)

    @override_settings(AUTH_REGISTER_IP_LIMIT=2)
    def test_signup_has_its_own_budget_and_does_not_create_a_user_when_blocked(self):
        for _ in range(2):
            self.assertEqual(
                Client().post("/register/", {"email": "invalid"}).status_code, 200
            )
        response = Client().post(
            "/register/",
            {
                "first_name": "Новый",
                "email": "new@example.test",
                "password1": "Test-password-42!",
                "password2": "Test-password-42!",
            },
        )
        self.assertEqual(response.status_code, 429)
        self.assertFalse(User.objects.filter(email="new@example.test").exists())
        self.assertEqual(self.login().status_code, 200)

    def test_invalid_csrf_does_not_consume_someone_elses_budget(self):
        client = Client(enforce_csrf_checks=True)
        self.assertEqual(
            client.post(
                "/login/", {"username": self.person.email, "password": "wrong"}
            ).status_code,
            403,
        )
        self.assertFalse(AuthRateLimit.objects.exists())

    @override_settings(AUTH_REGISTER_IP_LIMIT=1)
    def test_signup_credential_preflight_cannot_bypass_the_registration_budget(self):
        data = {
            "intent": "credentials",
            "email": "preflight@example.test",
            "password1": "Test-password-42!",
        }
        self.assertEqual(Client().post("/register/", data).status_code, 200)
        with patch("flow.views.RegisterForm") as form:
            response = Client().post("/register/", data)
        self.assertEqual(response.status_code, 429)
        self.assertFalse(response.json()["valid"])
        self.assertEqual(response.json()["code"], "AUTH_RATE_LIMITED")
        self.assertIn("Подождите", response.json()["error"])
        self.assertIn("Retry-After", response)
        form.assert_not_called()
        self.assertFalse(User.objects.filter(email=data["email"]).exists())
        self.assertNotIn(data["password1"], response.content.decode())

    def test_unavailable_throttle_fails_closed_without_leaking_database_details(self):
        with patch(
            "flow.security.take_auth_attempt",
            side_effect=OperationalError("private credential"),
        ):
            response = self.login()
        self.assertEqual(response.status_code, 503)
        self.assertNotIn(b"private credential", response.content)


@override_settings(
    PASSWORD_HASHERS=FAST_HASHER, AUTH_LOGIN_IP_LIMIT=5, AUTH_LOGIN_ACCOUNT_IP_LIMIT=5
)
class AuthenticationConcurrencyTests(TransactionTestCase):
    def test_twenty_simultaneous_guesses_cannot_exceed_the_budget(self):
        User.objects.create_user(
            "limited@example.test", "Test-password-42!", name="Участник"
        )
        barrier = Barrier(20)

        def attempt(_):
            close_old_connections()
            try:
                barrier.wait(timeout=15)
                return (
                    Client()
                    .post(
                        "/login/",
                        {"username": "limited@example.test", "password": "wrong"},
                    )
                    .status_code
                )
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=20) as pool:
            statuses = list(pool.map(attempt, range(20)))
        self.assertEqual(statuses.count(200), 5, statuses)
        self.assertEqual(statuses.count(429), 15, statuses)
        self.assertEqual(
            list(AuthRateLimit.objects.values_list("attempts", flat=True)), [5, 5]
        )


class ClientAddressTests(SimpleTestCase):
    @override_settings(IS_VERCEL=True)
    def test_vercel_uses_its_platform_overwritten_header(self):
        request = RequestFactory().get(
            "/",
            REMOTE_ADDR="",
            HTTP_X_VERCEL_FORWARDED_FOR="203.0.113.7",
            HTTP_X_FORWARDED_FOR="198.51.100.8",
        )
        self.assertEqual(client_address(request), "203.0.113.7")

    @override_settings(IS_VERCEL=False, AUTH_TRUSTED_PROXY_IPS=[])
    def test_vercel_header_is_not_trusted_on_other_hosts(self):
        request = RequestFactory().get(
            "/", REMOTE_ADDR="203.0.113.7", HTTP_X_VERCEL_FORWARDED_FOR="198.51.100.8"
        )
        self.assertEqual(client_address(request), "203.0.113.7")

    @override_settings(AUTH_TRUSTED_PROXY_IPS=[])
    def test_direct_peer_ignores_spoofed_headers(self):
        request = RequestFactory().get(
            "/", REMOTE_ADDR="203.0.113.7", HTTP_X_FORWARDED_FOR="198.51.100.8"
        )
        self.assertEqual(client_address(request), "203.0.113.7")

    @override_settings(AUTH_TRUSTED_PROXY_IPS=["127.0.0.0/8", "::1/128"])
    def test_trusted_proxy_chain_cannot_hide_the_nearest_untrusted_address(self):
        request = RequestFactory().get(
            "/",
            REMOTE_ADDR="127.0.0.1",
            HTTP_X_FORWARDED_FOR="198.51.100.8,203.0.113.7,127.0.0.2",
        )
        self.assertEqual(client_address(request), "203.0.113.7")
        request.META["HTTP_X_FORWARDED_FOR"] = "not-an-ip"
        self.assertEqual(client_address(request), "127.0.0.1")


class RequestBoundaryTests(SimpleTestCase):
    def test_declared_large_body_is_rejected_before_downstream_parsing(self):
        downstream = Mock()
        request = RequestFactory().post(
            "/api/profile",
            data=b"{}",
            content_type="application/json",
            CONTENT_LENGTH=str(300 * 1024),
        )
        response = RequestLimitsMiddleware(downstream)(request)
        self.assertEqual(response.status_code, 413)
        downstream.assert_not_called()

    def test_auth_forms_are_bounded_before_password_processing(self):
        for path in ["/login/", "/register/"]:
            with self.subTest(path=path):
                downstream = Mock()
                request = RequestFactory().post(
                    path,
                    data=b"x",
                    content_type="application/x-www-form-urlencoded",
                    CONTENT_LENGTH=str(65 * 1024),
                )
                self.assertEqual(
                    RequestLimitsMiddleware(downstream)(request).status_code, 413
                )
                downstream.assert_not_called()

    def test_upload_handler_stops_combined_file_data_at_five_mebibytes(self):
        request = RequestFactory().post("/api/profile/avatar")
        handler = AvatarUploadLimitHandler(request)
        chunk = b"x" * 1024 * 1024
        for index in range(5):
            self.assertEqual(
                handler.receive_data_chunk(chunk, index * len(chunk)), chunk
            )
        with self.assertRaises(StopUpload):
            handler.receive_data_chunk(b"x", 5 * len(chunk))
        self.assertTrue(request._tflow_upload_too_large)


@override_settings(PASSWORD_HASHERS=FAST_HASHER)
class UploadSecurityTests(Scenario, TestCase):
    def test_oversized_upload_is_rejected_without_decoding_or_saving(self):
        with patch("flow.avatars.prepare_avatar") as prepare:
            response = self.participant.post(
                "/api/profile/avatar",
                {
                    "avatar": SimpleUploadedFile(
                        "large.jpg", b"x" * (6 * 1024 * 1024 + 1)
                    )
                },
            )
        self.assertEqual(response.status_code, 413)
        self.assertEqual(response.json()["code"], "PAYLOAD_TOO_LARGE")
        prepare.assert_not_called()
        self.assertFalse(UserAvatar.objects.exists())

    def test_extra_file_cannot_bypass_the_combined_upload_budget(self):
        response = self.participant.post(
            "/api/profile/avatar",
            {
                "avatar": photo(),
                "extra": SimpleUploadedFile("extra.bin", b"x" * (5 * 1024 * 1024)),
            },
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "AVATAR_TOO_LARGE")
        self.assertFalse(UserAvatar.objects.exists())


@override_settings(PASSWORD_HASHERS=FAST_HASHER)
class ObjectAccessAuditTests(Scenario, TestCase):
    def test_foreign_organizer_cannot_mutate_any_part_of_an_event_or_read_attendees(
        self,
    ):
        self.publish()
        self.event.format = "Онлайн"
        self.event.save(update_fields=["format"])
        self.r1.is_online = True
        self.r1.save(update_fields=["is_online"])
        self.other.role = "organizer"
        self.other.save(update_fields=["role"])
        EventRegistration.objects.create(user=self.person, event=self.event)
        before = Event.objects.values().get(pk=self.event.pk)
        requests = [
            (f"events/{self.event.pk}", "patch", self.event_body(title="Подмена")),
            (f"events/{self.event.pk}", "delete", {}),
            (f"events/{self.event.pk}/publish", "post", {}),
            (
                f"events/{self.event.pk}/move",
                "patch",
                self.event_body(
                    starts_at=milliseconds(self.start + timedelta(days=1)),
                    ends_at=milliseconds(self.start + timedelta(days=2)),
                ),
            ),
            (
                f"events/{self.event.pk}/requirements",
                "patch",
                {"required_profile_fields": ["phone"]},
            ),
            (
                f"events/{self.event.pk}/rooms",
                "post",
                {"name": "Подмена", "capacity": 3},
            ),
            (f"rooms/{self.r1.pk}", "patch", {"name": "Подмена", "capacity": 3}),
            (f"events/{self.event.pk}/activities", "post", self.activity_body(self.a)),
            (f"activities/{self.a.pk}", "patch", self.activity_body(self.a)),
            (f"events/{self.event.pk}/attendance", "get", None),
            (f"events/{self.event.pk}/participants", "get", None),
            (
                f"events/{self.event.pk}/attendee?qr={self.person.pass_token}",
                "get",
                None,
            ),
            (
                f"events/{self.event.pk}/check-in",
                "post",
                {"qr": str(self.person.pass_token)},
            ),
            (f"events/{self.event.pk}/webinar", "get", None),
            *[
                (f"events/{self.event.pk}/webinar", "post", {"operation": operation})
                for operation in ["start", "join", "end"]
            ],
            (f"activities/{self.a.pk}/webinar", "get", None),
            *[
                (f"activities/{self.a.pk}/webinar", "post", {"operation": operation})
                for operation in ["start", "join", "end"]
            ],
        ]
        for path, method, body in requests:
            with self.subTest(path=path, method=method):
                response = self.request(
                    path,
                    method,
                    body,
                    client=self.stranger,
                    status=403,
                    code="FORBIDDEN",
                )
                self.assertNotIn(self.person.email, str(response))
        self.assertEqual(Event.objects.values().get(pk=self.event.pk), before)
        self.assertEqual(self.event.rooms.count(), 2)
        self.assertFalse(CheckIn.objects.exists())

    def test_notification_ids_and_cursors_do_not_grant_access_to_other_users(self):
        notice = Notification.objects.create(
            user=self.person, event=self.event, message="Приватное сообщение"
        )
        self.request(
            f"notifications/{notice.pk}", "patch", client=self.stranger, status=404
        )
        self.request(
            f"notifications?before={notice.pk}", client=self.stranger, status=404
        )
        notice.refresh_from_db()
        self.assertFalse(notice.read)


@override_settings(
    DEBUG=False,
    LIVEKIT_URL="https://video.example.test",
    LIVEKIT_API_KEY="test-key",
    LIVEKIT_API_SECRET="test-only-livekit-secret-at-least-32-bytes",
)
class VideoSecurityTests(SimpleTestCase):
    def test_production_refuses_cleartext_transport_and_weak_or_embedded_secrets(self):
        for changes in [
            {"LIVEKIT_URL": "ws://video.example.test"},
            {"LIVEKIT_URL": "http://video.example.test"},
            {"LIVEKIT_URL": "wss://user:password@video.example.test"},
            {"LIVEKIT_URL": "wss://video.example.test?token=secret"},
            {"LIVEKIT_API_SECRET": "secret"},
        ]:
            with self.subTest(changes=changes), override_settings(**changes):
                self.assertFalse(configured())
                with self.assertRaises(FlowError) as caught:
                    signed_token("viewer", "Участник", {"roomJoin": True})
                self.assertEqual(
                    (caught.exception.code, caught.exception.status),
                    ("VIDEO_NOT_CONFIGURED", 503),
                )

    @override_settings(
        DEBUG=True, LIVEKIT_URL="ws://127.0.0.1:7880", LIVEKIT_API_SECRET="secret"
    )
    def test_local_debug_video_remains_available(self):
        self.assertTrue(configured())

    def test_media_redirect_cannot_forward_administrative_bearer_token(self):
        visited = []

        class MediaTransport(HTTPSHandler):
            def https_open(self, request):
                visited.append(request.full_url)
                headers = Message()
                headers["Location"] = "https://attacker.example.test/collect"
                response = addinfourl(BytesIO(b""), headers, request.full_url, 302)
                response.msg = "Found"
                return response

        def opener(*handlers):
            return build_opener(*handlers, MediaTransport())

        with patch("flow.webinars.build_opener", side_effect=opener), self.assertRaises(
            FlowError
        ):
            room_api("CreateRoom", "private-room")
        self.assertEqual(
            visited, ["https://video.example.test/twirp/livekit.RoomService/CreateRoom"]
        )
