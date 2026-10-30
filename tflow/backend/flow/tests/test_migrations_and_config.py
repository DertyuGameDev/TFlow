import json
import os
from pathlib import Path
import subprocess
import sys
from datetime import timedelta

from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import SimpleTestCase, TransactionTestCase
from django.utils import timezone


class LegacyMigrationTests(TransactionTestCase):
    def test_backfill_assigns_unique_passes_roles_and_event_tickets(self):
        before = [("flow", "0002_schedule_lock")]
        after = [("flow", "0004_backfill_roles_and_passes")]
        executor = MigrationExecutor(connection)
        executor.migrate(before)
        try:
            apps = executor.loader.project_state(before).apps
            User = apps.get_model("flow", "User")
            Event = apps.get_model("flow", "Event")
            Room = apps.get_model("flow", "Room")
            Activity = apps.get_model("flow", "Activity")
            Registration = apps.get_model("flow", "Registration")
            owner = User.objects.create(email="old-owner@example.test", name="Организатор")
            person = User.objects.create(email="old-person@example.test", name="Участник")
            start = timezone.now()
            event = Event.objects.create(owner=owner, title="Событие", description="Событие", starts_at=start,
                                         ends_at=start+timedelta(hours=2), city="Москва", venue="Зал", format="Очно", topic="Наука", kind="Встреча")
            room = Room.objects.create(event=event, name="Зал", capacity=10)
            for number in range(2):
                activity = Activity.objects.create(event=event, room=room, title=f"Лекция {number}",
                                                   starts_at=start+timedelta(hours=number), ends_at=start+timedelta(hours=number+1), capacity=10)
                Registration.objects.create(user=person, activity=activity, created_at=start)
            executor = MigrationExecutor(connection)
            executor.migrate(after)
            apps = executor.loader.project_state(after).apps
            User = apps.get_model("flow", "User")
            Enrollment = apps.get_model("flow", "EventRegistration")
            owner = User.objects.get(pk=owner.pk)
            person = User.objects.get(pk=person.pk)
            self.assertEqual(owner.role, "organizer")
            self.assertEqual(person.role, "participant")
            self.assertIsNotNone(owner.pass_token)
            self.assertIsNotNone(person.pass_token)
            self.assertNotEqual(owner.pass_token, person.pass_token)
            ticket = Enrollment.objects.get(user_id=person.pk, event_id=event.pk)
            self.assertEqual(ticket.created_at, start)
        finally:
            executor = MigrationExecutor(connection)
            executor.migrate(executor.loader.graph.leaf_nodes())


class ProductionConfigTests(SimpleTestCase):
    def read_config(self, **changes):
        # A fresh process is needed: changing environment variables after Django
        # initializes would not exercise the actual deployment configuration.
        env = {key: value for key, value in os.environ.items()
               if key not in {"DATABASE_URL", "VERCEL", "DJANGO_DEBUG", "DJANGO_SECRET_KEY", "DJANGO_HTTPS_REDIRECT", "DJANGO_TRUST_PROXY"}}
        env.update(DJANGO_DEBUG="0", DJANGO_SECRET_KEY="isolated-config-test-secret-" * 3)
        env.update(changes)
        code = """
import json
from config import settings as s
print(json.dumps({
    "debug": s.DEBUG, "session_secure": s.SESSION_COOKIE_SECURE,
    "csrf_secure": s.CSRF_COOKIE_SECURE, "https_redirect": s.SECURE_SSL_REDIRECT,
    "hosts": s.ALLOWED_HOSTS, "origins": s.CSRF_TRUSTED_ORIGINS,
    "database": s.DATABASES["default"],
    "trusted_proxy": getattr(s, "SECURE_PROXY_SSL_HEADER", None),
}))
"""
        return subprocess.run([sys.executable, "-c", code], env=env, cwd=Path(__file__).resolve().parents[2],
                              capture_output=True, text=True, timeout=20)

    def test_production_enables_secure_cookies_and_https(self):
        result = self.read_config(DJANGO_TRUST_PROXY="0")
        self.assertEqual(result.returncode, 0, result.stderr)
        settings = json.loads(result.stdout)
        self.assertFalse(settings["debug"])
        self.assertTrue(settings["session_secure"])
        self.assertTrue(settings["csrf_secure"])
        self.assertTrue(settings["https_redirect"])
        self.assertIsNone(settings["trusted_proxy"])

    def test_production_without_secret_fails_closed(self):
        result = self.read_config(DJANGO_SECRET_KEY="")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Set DJANGO_SECRET_KEY", result.stderr)

    def test_vercel_requires_persistent_database(self):
        result = self.read_config(VERCEL="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("persistent PostgreSQL", result.stderr)

    def test_postgresql_url_is_decoded_and_only_supported_options_used(self):
        result = self.read_config(VERCEL="1", VERCEL_URL="preview.example.test",
                                  DATABASE_URL="postgresql://test%40user:pass%2Fword@localhost:5433/test%20db?sslmode=require&connect_timeout=5&ignored=value")
        self.assertEqual(result.returncode, 0, result.stderr)
        settings = json.loads(result.stdout)
        database = settings["database"]
        self.assertEqual(database["USER"], "test@user")
        self.assertEqual(database["PASSWORD"], "pass/word")
        self.assertEqual(database["NAME"], "test db")
        self.assertEqual(database["PORT"], 5433)
        self.assertEqual(database["OPTIONS"], {"sslmode": "require", "connect_timeout": "5"})
        self.assertEqual(database["CONN_MAX_AGE"], 0)
        self.assertIn("preview.example.test", settings["hosts"])
        self.assertIn("https://preview.example.test", settings["origins"])

    def test_non_postgresql_database_url_is_rejected(self):
        result = self.read_config(DATABASE_URL="sqlite:///tmp/invalid.sqlite3")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("DATABASE_URL must use PostgreSQL", result.stderr)
