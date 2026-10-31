from datetime import timedelta

from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase
from django.utils import timezone


class OnlineRoomMigrationTests(TransactionTestCase):
    def test_existing_automatic_online_room_is_reused_without_reclassifying_halls(self):
        before = [("flow", "0013_community_avatar")]
        after = [("flow", "0014_online_room")]
        executor = MigrationExecutor(connection)
        executor.migrate(before)
        try:
            apps = executor.loader.project_state(before).apps
            User, Event, Room = (
                apps.get_model("flow", name) for name in ["User", "Event", "Room"]
            )
            owner = User.objects.create(
                email="legacy-online@example.test", name="Организатор"
            )
            start = timezone.now()
            values = dict(
                owner=owner,
                title="Онлайн-встреча",
                description="Встреча",
                starts_at=start,
                ends_at=start + timedelta(hours=2),
                city="Москва",
                venue="Центр",
                topic="Разработка",
                kind="Лекция",
            )
            online = Event.objects.create(**values, format="Онлайн")
            physical = Event.objects.create(**values, format="Очно")
            # Legacy names were not unique; only one room can represent the stream.
            Room.objects.create(
                id="legacy-a", event=online, name="Онлайн-комната", capacity=30
            )
            Room.objects.create(
                id="legacy-b", event=online, name="Онлайн-комната", capacity=40
            )
            Room.objects.create(
                id="physical", event=physical, name="Онлайн-комната", capacity=50
            )
            executor = MigrationExecutor(connection)
            executor.migrate(after)
            Room = executor.loader.project_state(after).apps.get_model("flow", "Room")
            self.assertEqual(
                list(Room.objects.filter(is_online=True).values_list("pk", flat=True)),
                ["legacy-a"],
            )
            self.assertFalse(Room.objects.get(pk="physical").is_online)
            self.assertEqual(Room.objects.get(pk="legacy-b").capacity, 40)
        finally:
            executor = MigrationExecutor(connection)
            executor.migrate(executor.loader.graph.leaf_nodes())
