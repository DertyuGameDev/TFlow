from datetime import timedelta
from pathlib import Path
from tempfile import TemporaryDirectory

from django.contrib.sessions.models import Session
from django.db import IntegrityError, transaction
from django.db.models.deletion import ProtectedError
from django.test import Client, TestCase, override_settings

from flow.models import Activity, Bookmark, CheckIn, Event, EventRegistration, Membership, Community, Registration, Room, User
from .test_api import FAST_HASHER, Scenario


@override_settings(PASSWORD_HASHERS=FAST_HASHER)
class ModelConstraintTests(Scenario, TestCase):
    def test_database_rejects_duplicate_relationships(self):
        community = Community.objects.create(name="Клуб", description="Клуб", topic="Наука", color="blue")
        for model, values in [
            (Registration, {"user": self.person, "activity": self.a}),
            (EventRegistration, {"user": self.person, "event": self.event}),
            (CheckIn, {"user": self.person, "event": self.event, "checked_by": self.owner}),
            (Bookmark, {"user": self.person, "event": self.event}),
            (Membership, {"user": self.person, "community": community}),
        ]:
            with self.subTest(model=model.__name__):
                model.objects.create(**values)
                with self.assertRaises(IntegrityError), transaction.atomic():
                    model.objects.create(**values)

    def test_database_rejects_invalid_capacity_and_duration(self):
        for model, pk, changes in [
            (Event, self.event.pk, {"capacity": 0}),
            (Event, self.event.pk, {"capacity": 100001}),
            (Event, self.event.pk, {"ends_at": self.start}),
            (Room, self.r1.pk, {"capacity": 0}),
            (Room, self.r1.pk, {"capacity": 10001}),
            (Activity, self.a.pk, {"capacity": 0}),
            (Activity, self.a.pk, {"capacity": 10001}),
            (Activity, self.a.pk, {"ends_at": self.start-timedelta(seconds=1)}),
        ]:
            with self.subTest(model=model.__name__, changes=changes):
                with self.assertRaises(IntegrityError), transaction.atomic():
                    model.objects.filter(pk=pk).update(**changes)

    def test_database_rejects_duplicate_email_and_pass(self):
        for changes in [{"email": self.person.email}, {"pass_token": self.person.pass_token}]:
            with self.subTest(changes=changes):
                with self.assertRaises(IntegrityError), transaction.atomic():
                    User.objects.filter(pk=self.other.pk).update(**changes)

    def test_owner_and_used_room_are_protected_from_deletion(self):
        for instance in [self.owner, self.r1]:
            with self.subTest(model=type(instance).__name__):
                with self.assertRaises(ProtectedError):
                    instance.delete()

    def test_deleting_participant_removes_personal_relationships(self):
        Registration.objects.create(user=self.person, activity=self.a)
        EventRegistration.objects.create(user=self.person, event=self.event)
        Bookmark.objects.create(user=self.person, event=self.event)
        self.person.delete()
        for model in [Registration, EventRegistration, Bookmark]:
            self.assertFalse(model.objects.exists())
        self.assertTrue(Event.objects.filter(pk=self.event.pk).exists())

    def test_superuser_defaults_and_invalid_flags(self):
        user = User.objects.create_superuser("ROOT@EXAMPLE.TEST", "Strong-password-42!", name="Администратор")
        self.assertEqual(user.email, "root@example.test")
        self.assertEqual(user.role, "organizer")
        self.assertTrue(user.is_superuser and user.is_staff)
        for flag in ["is_staff", "is_superuser"]:
            with self.subTest(flag=flag), self.assertRaises(ValueError):
                User.objects.create_superuser("bad@example.test", None, **{flag: False})
        with self.assertRaises(ValueError):
            User.objects.create_user("", None)


@override_settings(PASSWORD_HASHERS=FAST_HASHER)
class RuntimeTests(Scenario, TestCase):
    def test_frontend_without_build_explains_unavailability(self):
        with TemporaryDirectory() as directory, override_settings(PROJECT_DIR=Path(directory)):
            response = self.client.get("/")
            self.assertEqual(response.status_code, 503)

    def test_frontend_serves_build_and_sets_csrf_cookie(self):
        with TemporaryDirectory() as directory, override_settings(PROJECT_DIR=Path(directory)):
            page = Path(directory) / "dist" / "index.html"
            page.parent.mkdir()
            page.write_text("<!doctype html><title>ТФлоу</title>")
            response = self.client.get("/")
            self.assertEqual(response.status_code, 200)
            self.assertIn("ТФлоу".encode(), b"".join(response.streaming_content))
            self.assertIn("csrftoken", self.client.cookies)

    def test_login_rotates_session_and_logout_invalidates_it(self):
        client = Client()
        session = client.session
        session["before_login"] = True
        session.save()
        old_key = session.session_key
        client.post("/login/", {"username": self.person.email, "password": "Local-test-password-42!"})
        authenticated_key = client.session.session_key
        self.assertNotEqual(old_key, authenticated_key)
        self.assertFalse(Session.objects.filter(session_key=old_key).exists())
        client.post("/logout/")
        self.assertFalse(Session.objects.filter(session_key=authenticated_key).exists())
        replay = Client()
        replay.cookies["sessionid"] = authenticated_key
        self.assertIsNone(replay.get("/api/auth/me").json()["user"])

    def test_security_headers(self):
        response = self.client.get("/login/")
        self.assertEqual(response["X-Frame-Options"], "DENY")
        self.assertEqual(response["X-Content-Type-Options"], "nosniff")

    @override_settings(DEBUG=False, SECURE_SSL_REDIRECT=True)
    def test_http_redirects_to_https(self):
        response = Client().get("/login/")
        self.assertEqual(response.status_code, 301)
        self.assertEqual(response["Location"], "https://testserver/login/")

    def test_invalid_host_is_rejected(self):
        self.assertEqual(Client().get("/login/", HTTP_HOST="evil.example").status_code, 400)
