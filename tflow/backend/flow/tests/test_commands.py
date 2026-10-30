"""Exercise the legacy importer using isolated, disposable SQLite snapshots."""
import sqlite3
import stat
from io import StringIO
from pathlib import Path
from tempfile import TemporaryDirectory

from django.core.management import CommandError, call_command
from django.test import TestCase, override_settings

from flow.models import Activity, Bookmark, Community, Event, EventRegistration, Membership, Notification, Registration, Room, User
from flow.serializers import milliseconds
from .test_api import FAST_HASHER, Scenario


@override_settings(PASSWORD_HASHERS=FAST_HASHER)
class ImportTests(Scenario, TestCase):
    def setUp(self):
        super().setUp()
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.settings_override = override_settings(DATA_DIR=self.directory)
        self.settings_override.enable()
        self.addCleanup(self.settings_override.disable)
        self.source = self.directory / "source #1?.sqlite3"

    def snapshot(self, *, existing_user=False, invalid_activity=False):
        owner_id = self.person.pk if existing_user else "legacy-owner"
        start = milliseconds(self.start)
        data = {
            "profiles": [dict(id=owner_id, name="Старый организатор", email="legacy-owner@example.test", city="Москва", about="", interests=""),
                         dict(id="legacy-person", name="Старый участник", email="legacy-person@example.test", city="Москва", about="", interests="")],
            "communities": [dict(id="legacy-community", name="Клуб", description="Клуб", topic="Наука", color="blue")],
            "events": [dict(id="legacy-event", owner_id=owner_id, title="Старое событие", description="Старое событие", city="Москва", venue="Зал", address="", format="Очно", topic="Наука", kind="Встреча", cover="yellow", status="published", community_id="legacy-community", starts_at=start, ends_at=start+3600000, updated_at=start)],
            "rooms": [dict(id="legacy-room", event_id="legacy-event", name="Зал", capacity=10)],
            "activities": [dict(id="legacy-activity", event_id="legacy-event", room_id="legacy-room", title="Лекция", description="", speaker="", capacity=11 if invalid_activity else 10, starts_at=start, ends_at=start+3600000, updated_at=start)],
            "registrations": [dict(user_id="legacy-person", activity_id="legacy-activity", created_at=start)],
            "bookmarks": [dict(user_id="legacy-person", event_id="legacy-event")],
            "memberships": [dict(user_id="legacy-person", community_id="legacy-community")],
            "notifications": [dict(id="legacy-notice", user_id="legacy-person", event_id="legacy-event", message="Сообщение", read=0, created_at=start)],
        }
        with sqlite3.connect(self.source) as connection:
            for table, rows in data.items():
                # All identifiers here are fixed test fixture keys, not user input.
                columns = ", ".join(f'"{column}"' for column in rows[0])
                connection.execute(f'CREATE TABLE "{table}" ({columns})')
                placeholders = ", ".join("?" for _ in rows[0])
                connection.executemany(f'INSERT INTO "{table}" VALUES ({placeholders})', [list(row.values()) for row in rows])
        return self.source

    def run_import(self):
        call_command("import_d1", str(self.source), stdout=StringIO())

    def test_import_all_entities_and_roles_without_changing_source(self):
        self.snapshot()
        original = self.source.read_bytes()
        self.run_import()
        self.assertEqual(self.source.read_bytes(), original)
        owner = User.objects.get(pk="legacy-owner")
        person = User.objects.get(pk="legacy-person")
        self.assertEqual(owner.role, "organizer")
        self.assertEqual(person.role, "participant")
        self.assertFalse(owner.has_usable_password())
        self.assertNotEqual(owner.pass_token, person.pass_token)
        for model, pk in [(Community, "legacy-community"), (Event, "legacy-event"), (Room, "legacy-room"),
                          (Activity, "legacy-activity"), (Notification, "legacy-notice")]:
            self.assertTrue(model.objects.filter(pk=pk).exists(), model.__name__)
        self.assertTrue(Registration.objects.filter(user=person, activity_id="legacy-activity").exists())
        self.assertTrue(EventRegistration.objects.filter(user=person, event_id="legacy-event").exists())
        self.assertTrue(Bookmark.objects.filter(user=person, event_id="legacy-event").exists())
        self.assertTrue(Membership.objects.filter(user=person, community_id="legacy-community").exists())
        backups = list((self.directory / "backups").glob("*.sqlite3"))
        self.assertEqual(len(backups), 1)
        self.assertEqual(stat.S_IMODE(backups[0].stat().st_mode), 0o600)

    def test_import_is_idempotent_and_preserves_existing_records(self):
        self.snapshot()
        self.run_import()
        Event.objects.filter(pk="legacy-event").update(title="Изменено в Django")
        models = [User, Event, Room, Activity, Registration, EventRegistration, Bookmark, Membership, Notification]
        counts = [model.objects.count() for model in models]
        self.run_import()
        self.assertEqual([model.objects.count() for model in models], counts)
        self.assertEqual(Event.objects.get(pk="legacy-event").title, "Изменено в Django")

    def test_import_does_not_promote_or_overwrite_existing_user(self):
        self.snapshot(existing_user=True)
        self.run_import()
        self.person.refresh_from_db()
        self.assertEqual(self.person.role, "participant")
        self.assertEqual(self.person.email, "person@example.test")
        self.assertTrue(self.person.check_password("Local-test-password-42!"))

    def test_invalid_activity_rolls_back_entire_import(self):
        self.snapshot(invalid_activity=True)
        with self.assertRaises(CommandError):
            self.run_import()
        self.assertFalse(User.objects.filter(pk="legacy-owner").exists())
        self.assertFalse(Event.objects.filter(pk="legacy-event").exists())
        self.assertFalse(Community.objects.exists())

    def test_missing_source_is_command_error(self):
        with self.assertRaises(CommandError):
            self.run_import()

    def test_non_sqlite_source_is_command_error(self):
        self.source.write_text("not a database")
        with self.assertRaises(CommandError):
            self.run_import()

    def test_missing_tables_is_command_error(self):
        with sqlite3.connect(self.source) as connection:
            connection.execute("CREATE TABLE unrelated (id)")
        with self.assertRaises(CommandError):
            self.run_import()

    def test_missing_columns_roll_back_import(self):
        self.snapshot()
        with sqlite3.connect(self.source) as connection:
            connection.execute("ALTER TABLE profiles RENAME COLUMN email TO invalid_email")
        with self.assertRaises(CommandError):
            self.run_import()
        self.assertFalse(User.objects.filter(pk="legacy-owner").exists())

    def test_invalid_foreign_key_rolls_back_import(self):
        self.snapshot()
        with sqlite3.connect(self.source) as connection:
            connection.execute("UPDATE activities SET room_id = ?", ["missing"])
        with self.assertRaises(CommandError):
            self.run_import()
        self.assertFalse(Event.objects.filter(pk="legacy-event").exists())
