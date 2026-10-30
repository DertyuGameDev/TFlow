import sqlite3
import os
from datetime import datetime, timezone
from pathlib import Path
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.core.exceptions import ObjectDoesNotExist
from django.db import IntegrityError
from flow.contracts import FlowError
from flow.models import (
    Activity,
    Bookmark,
    Community,
    Event,
    EventRegistration,
    Membership,
    Notification,
    Registration,
    Room,
    User,
)
from flow.services import schedule_write, validate_activity


def timestamp(value):
    return datetime.fromtimestamp(value / 1000, timezone.utc)


class Command(BaseCommand):
    help = "Import a read-only snapshot of the previous D1 SQLite database. Existing Django records are never overwritten."

    def add_arguments(self, parser):
        parser.add_argument("source", type=Path)

    def handle(self, *args, **options):
        source = options["source"].resolve()
        if not source.is_file():
            raise CommandError("Source SQLite file not found")
        backup_dir = settings.DATA_DIR / "backups"
        backup_dir.mkdir(mode=0o700, exist_ok=True)
        backup = backup_dir / (
            "d1-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%f") + ".sqlite3"
        )
        # Set permissions before copying personal data, rather than afterwards.
        descriptor = os.open(backup, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        os.close(descriptor)
        original = sqlite3.connect(source.as_uri() + "?mode=ro", uri=True)
        try:
            with sqlite3.connect(backup) as destination:
                original.backup(destination)
        except sqlite3.DatabaseError as error:
            raise CommandError("Unable to read the source SQLite database") from error
        finally:
            original.close()
        backup.chmod(0o600)
        connection = sqlite3.connect(backup.as_uri() + "?mode=ro", uri=True)
        connection.row_factory = sqlite3.Row
        counts = {}
        try:
            tables = {
                r[0]
                for r in connection.execute(
                    "SELECT name FROM sqlite_master WHERE type='table'"
                )
            }
            expected = {
                "profiles",
                "communities",
                "events",
                "rooms",
                "activities",
                "registrations",
                "bookmarks",
                "memberships",
                "notifications",
            }
            if not expected.issubset(tables):
                raise CommandError("This file is not a TFlow D1 database")
            data = {
                table: [
                    dict(row) for row in connection.execute(f'SELECT * FROM "{table}"')
                ]
                for table in sorted(expected)
            }
            with schedule_write():
                created_user_ids = []
                for row in data["profiles"]:
                    user, created = User.objects.get_or_create(
                        pk=row["id"],
                        defaults={
                            k: row[k]
                            for k in ["name", "email", "city", "about", "interests"]
                        },
                    )
                    if created:
                        created_user_ids.append(user.pk)
                        user.set_unusable_password()
                        user.save(update_fields=["password"])
                for row in data["communities"]:
                    Community.objects.get_or_create(
                        pk=row["id"],
                        defaults={
                            k: row[k] for k in ["name", "description", "topic", "color"]
                        },
                    )
                for row in data["events"]:
                    values = {
                        k: row[k]
                        for k in [
                            "owner_id",
                            "title",
                            "description",
                            "city",
                            "venue",
                            "address",
                            "format",
                            "topic",
                            "kind",
                            "cover",
                            "status",
                            "community_id",
                        ]
                    }
                    values.update(
                        {
                            key: timestamp(row[key])
                            for key in ["starts_at", "ends_at", "updated_at"]
                        }
                    )
                    Event.objects.get_or_create(pk=row["id"], defaults=values)
                for row in data["rooms"]:
                    Room.objects.get_or_create(
                        pk=row["id"],
                        defaults={k: row[k] for k in ["event_id", "name", "capacity"]},
                    )
                for row in data["activities"]:
                    values = {
                        k: row[k]
                        for k in [
                            "event_id",
                            "room_id",
                            "title",
                            "description",
                            "speaker",
                            "capacity",
                        ]
                    }
                    values.update(
                        {
                            key: timestamp(row[key])
                            for key in ["starts_at", "ends_at", "updated_at"]
                        }
                    )
                    Activity.objects.get_or_create(pk=row["id"], defaults=values)
                for row in data["registrations"]:
                    Registration.objects.get_or_create(
                        user_id=row["user_id"],
                        activity_id=row["activity_id"],
                        defaults={"created_at": timestamp(row["created_at"])},
                    )
                    EventRegistration.objects.get_or_create(
                        user_id=row["user_id"],
                        event_id=Activity.objects.get(pk=row["activity_id"]).event_id,
                        defaults={"created_at": timestamp(row["created_at"])},
                    )
                # An import must not grant privileges to existing accounts.
                User.objects.filter(pk__in=created_user_ids).filter(
                    pk__in=Event.objects.values("owner_id")
                ).update(role="organizer")
                for row in data["bookmarks"]:
                    Bookmark.objects.get_or_create(
                        user_id=row["user_id"], event_id=row["event_id"]
                    )
                for row in data["memberships"]:
                    Membership.objects.get_or_create(
                        user_id=row["user_id"], community_id=row["community_id"]
                    )
                for row in data["notifications"]:
                    Notification.objects.get_or_create(
                        pk=row["id"],
                        defaults={
                            "user_id": row["user_id"],
                            "event_id": row["event_id"],
                            "message": row["message"],
                            "read": bool(row["read"]),
                            "created_at": timestamp(row["created_at"]),
                        },
                    )
                # Import must not introduce conflicts into an already populated target.
                for activity in Activity.objects.select_related("event"):
                    validate_activity(activity)
                counts = {table: len(rows) for table, rows in data.items()}
        except (
            sqlite3.DatabaseError,
            ValueError,
            TypeError,
            KeyError,
            OverflowError,
            IntegrityError,
            ObjectDoesNotExist,
            FlowError,
        ) as error:
            raise CommandError(
                "Unable to import this database; the original file was not changed"
            ) from error
        finally:
            connection.close()
        self.stdout.write(
            self.style.SUCCESS(
                f"Imported source rows: {counts}. Source unchanged; snapshot: {backup}"
            )
        )
