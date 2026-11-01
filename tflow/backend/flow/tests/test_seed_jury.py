from io import StringIO

from django.core.management import CommandError, call_command
from django.test import Client, TestCase, override_settings

from flow.models import (
    Activity,
    CheckIn,
    Event,
    EventRegistration,
    EventWaitlistEntry,
    User,
    WaitlistEntry,
)
from flow.services import validate_activity


@override_settings(
    DEBUG=True,
    IS_VERCEL=False,
    PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"],
    ALLOWED_HOSTS=["localhost", "testserver", "example.com"],
)
class JuryDemoTests(TestCase):
    def seed(self):
        call_command("seed_jury", stdout=StringIO())

    def test_repeatable_complete_roles_scenarios_and_preserves_existing_data(self):
        # The helper is intentionally local SQLite only; PostgreSQL CI checks the guard instead.
        from django.db import connection

        if connection.vendor != "sqlite":
            with self.assertRaises(CommandError):
                self.seed()
            self.assertFalse(User.objects.exists())
            return
        existing = User.objects.create_user(
            "existing@example.test", "Existing-user-42!", name="Existing"
        )
        self.seed()
        self.seed()
        self.assertEqual(User.objects.count(), 12)
        self.assertEqual(Event.objects.count(), 11)
        self.assertEqual(Activity.objects.count(), 30)
        self.assertEqual(Event.objects.filter(status="published").count(), 10)
        self.assertEqual(Event.objects.values("topic").distinct().count(), 11)
        self.assertEqual(EventWaitlistEntry.objects.count(), 2)
        self.assertEqual(WaitlistEntry.objects.count(), 1)
        self.assertEqual(CheckIn.objects.count(), 3)
        for activity in Activity.objects.select_related("event", "room"):
            validate_activity(activity)
        for registration in EventRegistration.objects.select_related("event"):
            self.assertTrue(
                all(
                    registration.profile_data.get(key)
                    for key in registration.event.required_profile_fields
                )
            )
        for alias in [*map(str, range(1, 11)), "test"]:
            user = User.objects.get(email=alias + "@jury.example.test")
            self.assertTrue(user.check_password(alias))
            self.assertEqual(
                user.role, "organizer" if alias == "test" else "participant"
            )
            browser = Client(HTTP_HOST="localhost")
            result = browser.post("/login/", {"username": alias, "password": alias})
            self.assertEqual(result.status_code, 302)
            self.assertEqual(
                browser.get("/api/auth/me").json()["user"]["userId"], user.pk
            )
        existing.refresh_from_db()
        self.assertTrue(existing.check_password("Existing-user-42!"))

    def test_production_and_remote_host_never_enable_short_logins(self):
        from django.db import connection

        if connection.vendor == "sqlite":
            self.seed()
        with override_settings(DEBUG=False):
            with self.assertRaises(CommandError):
                self.seed()
            page = Client(HTTP_HOST="localhost").get("/login/")
            self.assertContains(page, 'type="email"')
            self.assertEqual(
                Client(HTTP_HOST="localhost")
                .post("/login/", {"username": "1", "password": "1"})
                .status_code,
                200,
            )
        page = Client(HTTP_HOST="example.com").get("/login/")
        self.assertContains(page, 'type="email"')

    def test_reserved_identity_conflict_rolls_back_without_resetting_password(self):
        from django.db import connection

        if connection.vendor != "sqlite":
            return
        user = User.objects.create_user(
            "2@jury.example.test", "Keep-this-password-42!", name="Existing user"
        )
        with self.assertRaises(CommandError):
            self.seed()
        self.assertEqual(User.objects.count(), 1)
        user.refresh_from_db()
        self.assertTrue(user.check_password("Keep-this-password-42!"))
        self.assertFalse(Event.objects.exists())
