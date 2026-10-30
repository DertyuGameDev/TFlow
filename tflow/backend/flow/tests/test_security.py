"""API regression tests: authorization, hostile input and transaction boundaries."""

import json
import sys
from datetime import datetime, timedelta, timezone as dt_timezone
from unittest.mock import patch

from django.db import IntegrityError, OperationalError
from django.test import Client, TestCase, override_settings

from flow.models import (
    Activity,
    Bookmark,
    Community,
    Event,
    EventRegistration,
    Membership,
    Notification,
    Registration,
    User,
)
from flow.serializers import milliseconds
from .test_api import FAST_HASHER, Scenario


@override_settings(PASSWORD_HASHERS=FAST_HASHER)
class SecurityTests(Scenario, TestCase):
    def administrative_requests(self):
        event = self.event.pk
        return [
            ("events", "post", self.event_body()),
            (f"events/{event}", "patch", self.event_body()),
            (f"events/{event}/publish", "post", {}),
            (f"events/{event}/move", "patch", self.event_body()),
            (f"events/{event}/rooms", "post", {"name": "Зал", "capacity": 20}),
            (f"events/{event}/activities", "post", self.activity_body(self.a)),
            (f"rooms/{self.r1.pk}", "patch", {"name": "Зал", "capacity": 20}),
            (f"activities/{self.a.pk}", "patch", self.activity_body(self.a)),
            (f"events/{event}/participants", "get", None),
            (f"events/{event}/attendance", "get", None),
            (f"events/{event}/attendee?qr={self.person.pass_token}", "get", None),
            (f"events/{event}/check-in", "post", {"qr": str(self.person.pass_token)}),
        ]

    def test_anonymous_cannot_mutate_or_read_private_endpoints(self):
        requests = self.administrative_requests() + [
            ("profile", "patch", {"name": "Имя", "city": "Москва"}),
            ("notifications", "patch", {}),
            ("profile/qr", "get", None),
            (f"events/{self.event.pk}/bookmark", "post", {}),
            (f"events/{self.event.pk}/registration", "post", {}),
            (f"events/{self.event.pk}/registration", "delete", {}),
            (f"activities/{self.a.pk}/registration", "post", {}),
            (f"activities/{self.a.pk}/registration", "delete", {}),
            ("communities/missing/join", "post", {}),
        ]
        for path, method, body in requests:
            with self.subTest(path=path, method=method):
                self.request(
                    path, method, body, client=Client(), status=401, code="UNAUTHORIZED"
                )

    def test_unrelated_organizer_cannot_manage_other_events(self):
        self.other.role = "organizer"
        self.other.save(update_fields=["role"])
        for path, method, body in self.administrative_requests():
            if path == "events":
                continue
            with self.subTest(path=path):
                self.request(
                    path,
                    method,
                    body,
                    client=self.stranger,
                    status=403,
                    code="FORBIDDEN",
                )

    def test_inactive_session_cannot_access_private_data(self):
        self.person.is_active = False
        self.person.save(update_fields=["is_active"])
        self.assertIsNone(self.request("auth/me", client=self.participant)["user"])
        self.request("profile/qr", client=self.participant, status=401)

    def test_bootstrap_does_not_leak_other_users_private_data(self):
        self.publish()
        Notification.objects.create(
            user=self.person, event=self.event, message="Личное сообщение"
        )
        EventRegistration.objects.create(user=self.person, event=self.event)
        Registration.objects.create(user=self.person, activity=self.a)
        for client in [Client(), self.stranger]:
            state = self.request("bootstrap", client=client)
            self.assertEqual(state["notifications"], [])
            self.assertEqual(state["schedule"], [])
            self.assertEqual(state["tickets"], [])
            self.assertNotIn(str(self.person.pass_token), json.dumps(state))
            self.assertNotIn(self.person.email, json.dumps(state))
        anonymous = self.request("bootstrap", client=Client())
        self.assertIsNone(anonymous["profile"])

    def test_extra_fields_cannot_change_privileges_or_event_owner(self):
        self.request(
            "profile",
            "patch",
            {
                "name": "Новое имя",
                "city": "Москва",
                "is_superuser": True,
                "is_staff": True,
                "email": self.owner.email,
                "password": "plain",
            },
            client=self.participant,
        )
        self.person.refresh_from_db()
        self.assertFalse(self.person.is_superuser)
        self.assertFalse(self.person.is_staff)
        self.assertEqual(self.person.email, "person@example.test")
        self.assertTrue(self.person.check_password("Local-test-password-42!"))
        result = self.request(
            "events",
            "post",
            self.event_body(status="published", owner_id=self.person.pk),
            status=201,
        )
        event = Event.objects.get(pk=result["id"])
        self.assertEqual(event.status, "draft")
        self.assertEqual(event.owner_id, self.owner.pk)

    def test_malformed_and_non_object_json_returns_validation_error(self):
        for raw in ["{", "[]", "null", "true", '"text"', "42", b"\xff", '{"name":NaN}']:
            with self.subTest(raw=raw):
                response = self.participant.patch(
                    "/api/profile", data=raw, content_type="application/json"
                )
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.json()["code"], "VALIDATION")

    def test_deeply_nested_json_returns_validation_error(self):
        depth = sys.getrecursionlimit() + 100
        raw = ('{"name":"Updated","city":"Moscow","ignored":'
               + "[" * depth + "0" + "]" * depth + "}")
        response = self.participant.patch(
            "/api/profile", data=raw, content_type="application/json"
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "VALIDATION")
        self.person.refresh_from_db()
        self.assertNotEqual(self.person.name, "Updated")

    @override_settings(DATA_UPLOAD_MAX_MEMORY_SIZE=128)
    def test_oversized_json_returns_structured_error(self):
        response = self.participant.patch(
            "/api/profile",
            data=json.dumps({"about": "x" * 256}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 413)
        self.assertEqual(response.json()["code"], "PAYLOAD_TOO_LARGE")

    def test_invalid_unicode_and_null_bytes_cannot_reach_database(self):
        for field in [
            "title",
            "description",
            "city",
            "venue",
            "address",
            "topic",
            "kind",
        ]:
            for value in ["bad\ud800value", "bad\x00value"]:
                with self.subTest(field=field, value=repr(value)):
                    self.request(
                        "events",
                        "post",
                        self.event_body(**{field: value}),
                        status=400,
                        code="VALIDATION",
                    )

    def test_structured_values_are_not_silently_converted_to_text(self):
        for value in [{"nested": "text"}, ["text"], True, 123]:
            with self.subTest(value=value):
                self.request(
                    "profile",
                    "patch",
                    {"name": value, "city": "Москва"},
                    client=self.participant,
                    status=400,
                    code="VALIDATION",
                )

    def test_dates_reject_invalid_types_and_bounds(self):
        for value in [True, None, "123", -1, 0, 1.25, 253402300799000, [], {}]:
            with self.subTest(value=value):
                self.request(
                    "events",
                    "post",
                    self.event_body(starts_at=value),
                    status=400,
                    code="VALIDATION",
                )

    def test_capacity_validation_for_events_rooms_and_activities(self):
        for value in [-1, 0, 100001, True, [], {}]:
            with self.subTest(value=value):
                self.request(
                    "events",
                    "post",
                    self.event_body(capacity=value),
                    status=400,
                    code="VALIDATION",
                )
        for path, method, base in [
            (f"events/{self.event.pk}/rooms", "post", {"name": "Зал"}),
            (f"activities/{self.a.pk}", "patch", self.activity_body(self.a)),
        ]:
            for value in [0, -1, 10001]:
                with self.subTest(path=path, value=value):
                    self.request(
                        path,
                        method,
                        {**base, "capacity": value},
                        status=400,
                        code="VALIDATION",
                    )

    def test_missing_references_return_errors(self):
        for path, method, body, status in [
            ("events/missing", "get", None, 404),
            ("events/missing/publish", "post", {}, 404),
            ("events/missing/registration", "post", {}, 404),
            ("activities/missing/registration", "post", {}, 404),
            ("activities/missing", "patch", self.activity_body(self.a), 404),
            ("rooms/missing", "patch", {"name": "Зал", "capacity": 10}, 404),
            ("communities/missing/join", "post", {}, 404),
            ("events", "post", self.event_body(community_id="missing"), 400),
            (
                f"activities/{self.a.pk}",
                "patch",
                self.activity_body(self.a, room_id="missing"),
                400,
            ),
        ]:
            with self.subTest(path=path):
                self.request(path, method, body, status=status)

    def test_unknown_paths_and_unsupported_methods(self):
        for path in ["unknown", "events/a/b/c", f"events/{self.event.pk}/unknown"]:
            self.request(path, status=404, code="NOT_FOUND")
        response = self.client.put(
            "/api/profile", data="{}", content_type="application/json"
        )
        self.assertEqual(response.status_code, 405)

    def test_database_errors_do_not_expose_internal_details(self):
        for error, status, code in [
            (IntegrityError("private SQL"), 409, "CONFLICT"),
            (OperationalError("private connection string"), 503, "DATABASE_BUSY"),
        ]:
            with self.subTest(error=type(error).__name__), patch(
                "flow.views.dispatch_api", side_effect=error
            ):
                with self.assertLogs("flow", level="ERROR"):
                    result = self.request("bootstrap", status=status, code=code)
                self.assertNotIn("private", json.dumps(result))

    def test_personal_api_responses_are_not_cacheable(self):
        for path in ["auth/me", "bootstrap", "profile/qr"]:
            response = self.participant.get("/api/" + path)
            self.assertIn("no-store", response["Cache-Control"])


@override_settings(PASSWORD_HASHERS=FAST_HASHER)
class FunctionalRegressionTests(Scenario, TestCase):
    def test_edit_event_notifies_ticket_holders_and_activity_users_once(self):
        EventRegistration.objects.create(user=self.person, event=self.event)
        EventRegistration.objects.create(user=self.other, event=self.event)
        Registration.objects.create(user=self.other, activity=self.a)
        self.request(
            f"events/{self.event.pk}", "patch", self.event_body(venue="Новая площадка")
        )
        self.assertCountEqual(
            Notification.objects.values_list("user_id", flat=True),
            [self.person.pk, self.other.pk],
        )

    def test_unchanged_event_does_not_send_notifications(self):
        EventRegistration.objects.create(user=self.person, event=self.event)
        self.request(f"events/{self.event.pk}", "patch", self.event_body())
        self.assertFalse(Notification.objects.exists())

    def test_event_capacity_cannot_drop_below_ticket_count(self):
        EventRegistration.objects.bulk_create(
            [
                EventRegistration(user=self.person, event=self.event),
                EventRegistration(user=self.other, event=self.event),
            ]
        )
        self.request(
            f"events/{self.event.pk}",
            "patch",
            self.event_body(capacity=1),
            status=409,
            code="BELOW_REGISTERED",
        )
        self.event.refresh_from_db()
        self.assertEqual(self.event.capacity, 500)

    def test_full_event_does_not_leave_activity_registration(self):
        self.publish()
        self.event.capacity = 1
        self.event.save(update_fields=["capacity"])
        EventRegistration.objects.create(user=self.other, event=self.event)
        self.request(
            f"activities/{self.a.pk}/registration",
            "post",
            client=self.participant,
            status=409,
            code="NO_SEATS",
        )
        self.assertFalse(Registration.objects.filter(user=self.person).exists())
        self.assertFalse(EventRegistration.objects.filter(user=self.person).exists())

    def test_existing_ticket_allows_activity_when_event_is_full(self):
        self.publish()
        self.event.capacity = 1
        self.event.save(update_fields=["capacity"])
        EventRegistration.objects.create(user=self.person, event=self.event)
        self.request(
            f"activities/{self.a.pk}/registration", "post", client=self.participant
        )

    def test_event_registration_rejects_draft_and_finished_event(self):
        self.request(
            f"events/{self.event.pk}/registration",
            "post",
            client=self.participant,
            status=409,
            code="NOT_PUBLISHED",
        )
        Event.objects.filter(pk=self.event.pk).update(
            status="published",
            starts_at=self.start - timedelta(days=30),
            ends_at=self.start - timedelta(days=29),
        )
        self.request(
            f"events/{self.event.pk}/registration",
            "post",
            client=self.participant,
            status=409,
            code="REGISTRATION_CLOSED",
        )

    def test_cancel_activity_keeps_ticket_and_is_idempotent(self):
        self.publish()
        self.request(
            f"activities/{self.a.pk}/registration", "post", client=self.participant
        )
        for _ in range(2):
            self.request(
                f"activities/{self.a.pk}/registration",
                "delete",
                client=self.participant,
            )
        self.assertTrue(
            EventRegistration.objects.filter(
                user=self.person, event=self.event
            ).exists()
        )
        self.assertFalse(Registration.objects.filter(user=self.person).exists())

    def test_bookmark_and_membership_repeated_actions_are_isolated(self):
        self.publish()
        community = Community.objects.create(
            name="Клуб", description="Клуб", topic="Наука", color="blue"
        )
        for client in [self.participant, self.stranger]:
            for _ in range(2):
                self.request(f"events/{self.event.pk}/bookmark", "post", client=client)
                self.request(f"communities/{community.pk}/join", "post", client=client)
        for _ in range(2):
            self.request(
                f"events/{self.event.pk}/bookmark", "delete", client=self.participant
            )
            self.request(
                f"communities/{community.pk}/join", "delete", client=self.participant
            )
        self.assertEqual(Bookmark.objects.get().user_id, self.other.pk)
        self.assertEqual(Membership.objects.get().user_id, self.other.pk)
        state = self.request("bootstrap", client=self.stranger)
        self.assertEqual(state["communities"][0]["member_count"], 1)

    def test_create_activity_and_edit_preserve_relations(self):
        body = self.activity_body(
            self.a,
            starts_at=milliseconds(self.start + timedelta(hours=4)),
            ends_at=milliseconds(self.start + timedelta(hours=5)),
        )
        created = self.request(
            f"events/{self.event.pk}/activities", "post", body, status=201
        )
        self.request(
            f"activities/{created['id']}", "patch", {**body, "title": "Новая лекция"}
        )
        activity = Activity.objects.get(pk=created["id"])
        self.assertEqual(activity.event_id, self.event.pk)
        self.assertEqual(activity.title, "Новая лекция")

    def test_shortened_move_rolls_back_everything(self):
        self.request(
            f"events/{self.event.pk}/move",
            "patch",
            self.event_body(ends_at=milliseconds(self.start + timedelta(minutes=30))),
            status=409,
            code="EVENT_DATES",
        )
        self.event.refresh_from_db()
        self.a.refresh_from_db()
        self.assertEqual(self.event.ends_at, self.start + timedelta(hours=9))
        self.assertEqual(self.a.starts_at, self.start)
        self.assertFalse(Notification.objects.exists())

    def test_move_date_overflow_is_validation_error_and_rolls_back(self):
        Activity.objects.exclude(pk=self.a.pk).delete()
        Activity.objects.filter(pk=self.a.pk).update(
            starts_at=self.start + timedelta(days=1),
            ends_at=self.start + timedelta(days=1, hours=1),
        )
        Event.objects.filter(pk=self.event.pk).update(
            ends_at=self.start + timedelta(days=2)
        )
        far = datetime(9999, 12, 31, 20, tzinfo=dt_timezone.utc)
        self.request(
            f"events/{self.event.pk}/move",
            "patch",
            self.event_body(
                starts_at=milliseconds(far),
                ends_at=milliseconds(far + timedelta(hours=1)),
            ),
            status=400,
            code="VALIDATION",
        )
        self.event.refresh_from_db()
        self.assertEqual(self.event.starts_at, self.start)

    def test_inactive_attendee_qr_is_denied(self):
        EventRegistration.objects.create(user=self.person, event=self.event)
        self.person.is_active = False
        self.person.save(update_fields=["is_active"])
        self.request(
            f"events/{self.event.pk}/check-in",
            "post",
            {"qr": str(self.person.pass_token)},
            status=409,
            code="NOT_REGISTERED",
        )


@override_settings(PASSWORD_HASHERS=FAST_HASHER)
class AuthenticationRegressionTests(TestCase):
    password = "Unique-auth-regression-42!"

    def setUp(self):
        self.user = User.objects.create_user(
            "login@example.test", self.password, name="Участник"
        )

    def signup(self, **changes):
        return {
            "name": "Новый участник",
            "email": "new@example.test",
            "password1": self.password,
            "password2": self.password,
            **changes,
        }

    def test_login_normalizes_email_and_rejects_wrong_password(self):
        response = self.client.post(
            "/login/", {"username": " LOGIN@EXAMPLE.TEST ", "password": self.password}
        )
        self.assertEqual(response.status_code, 302)
        self.assertEqual(
            self.client.get("/api/auth/me").json()["user"]["userId"], self.user.pk
        )
        stranger = Client()
        self.assertEqual(
            stranger.post(
                "/login/", {"username": self.user.email, "password": "wrong"}
            ).status_code,
            200,
        )
        self.assertIsNone(stranger.get("/api/auth/me").json()["user"])

    def test_inactive_user_cannot_login(self):
        self.user.is_active = False
        self.user.save(update_fields=["is_active"])
        self.client.post(
            "/login/", {"username": self.user.email, "password": self.password}
        )
        self.assertIsNone(self.client.get("/api/auth/me").json()["user"])

    def test_signup_rejects_duplicate_email_weak_password_and_invalid_role(self):
        for changes in [
            {"email": "LOGIN@EXAMPLE.TEST"},
            {"password1": "123", "password2": "123"},
            {"password2": "mismatch"},
            {"role": "admin"},
            {"email": "invalid"},
            {"name": "x"},
        ]:
            with self.subTest(changes=changes):
                response = self.client.post("/register/", self.signup(**changes))
                self.assertEqual(response.status_code, 200)
                self.assertEqual(User.objects.count(), 1)

    def test_signup_defaults_to_participant_and_ignores_staff_flags(self):
        self.client.post(
            "/register/",
            self.signup(email=" NEW@EXAMPLE.TEST ", is_staff="1", is_superuser="1"),
        )
        user = User.objects.get(email="new@example.test")
        self.assertEqual(user.role, "participant")
        self.assertFalse(user.is_staff)
        self.assertFalse(user.is_superuser)

    def test_redirect_rejects_external_and_scheme_relative_urls(self):
        for target in [
            "https://evil.test",
            "//evil.test",
            "/\\evil.test",
            "javascript:alert(1)",
        ]:
            with self.subTest(target=target):
                client = Client()
                response = client.post(
                    "/login/",
                    {
                        "username": self.user.email,
                        "password": self.password,
                        "next": target,
                    },
                )
                self.assertEqual(response["Location"], "/")

    def test_redirect_preserves_local_hash(self):
        response = self.client.post(
            "/login/",
            {
                "username": self.user.email,
                "password": self.password,
                "next": "/#tickets",
            },
        )
        self.assertEqual(response["Location"], "/#tickets")

    def test_registration_and_logout_require_csrf(self):
        client = Client(enforce_csrf_checks=True)
        self.assertEqual(client.post("/register/", self.signup()).status_code, 403)
        client.force_login(self.user)
        self.assertEqual(client.post("/logout/").status_code, 403)
        self.assertEqual(User.objects.count(), 1)

    def test_template_escapes_submitted_html(self):
        response = self.client.post(
            "/register/",
            self.signup(name='<script>alert("x")</script>', password2="wrong"),
        )
        self.assertNotContains(response, '<script>alert("x")</script>')
        self.assertContains(response, "&lt;script&gt;")
