import json
from datetime import timedelta

from django.test import Client, TestCase, override_settings

from flow.models import Activity, Event, Room
from flow.serializers import milliseconds
from .test_api import FAST_HASHER, Scenario


@override_settings(PASSWORD_HASHERS=FAST_HASHER)
class CatalogActivitiesTests(Scenario, TestCase):
    def test_participant_sees_only_published_programs_with_schedule_metadata(self):
        self.publish()
        draft = Event.objects.create(
            owner=self.owner, title="Закрытый черновик", starts_at=self.start,
            ends_at=self.start + timedelta(hours=3), city="Москва", venue="Другая площадка",
        )
        room = Room.objects.create(event=draft, name="Закрытая аудитория", capacity=10)
        Activity.objects.create(
            event=draft, room=room, title="Неопубликованная активность",
            starts_at=self.start, ends_at=self.start + timedelta(hours=1), capacity=10,
        )
        result = self.request("bootstrap", client=self.participant)
        activities = result["activities"]
        self.assertEqual({item["id"] for item in activities}, {self.a.pk, self.b.pk, self.c.pk, self.d.pk})
        first = next(item for item in activities if item["id"] == self.a.pk)
        self.assertEqual(first["event_title"], self.event.title)
        self.assertEqual(first["room_name"], self.r1.name)
        self.assertEqual(first["starts_at"], milliseconds(self.a.starts_at))
        self.assertEqual(first["ends_at"], milliseconds(self.a.ends_at))
        self.assertNotIn("Неопубликованная активность", json.dumps(activities, ensure_ascii=False))
        self.assertNotIn(self.person.email, json.dumps(activities))
        self.assertNotIn(str(self.person.pass_token), json.dumps(activities))

    def test_catalog_programs_are_loaded_only_for_participants(self):
        self.publish()
        for client in [self.client, Client()]:
            with self.subTest(client=client):
                self.assertEqual(self.request("bootstrap", client=client)["activities"], [])
        self.assertEqual(len(self.request("bootstrap", client=self.participant)["activities"]), 4)

    def test_catalog_reflects_each_participants_registration_and_waitlist(self):
        self.publish()
        self.request(f"activities/{self.a.pk}/registration", "post", client=self.participant)
        self.request(f"activities/{self.a.pk}/waitlist", "post", client=self.stranger)
        registered = next(item for item in self.request("bootstrap", client=self.participant)["activities"] if item["id"] == self.a.pk)
        waiting = next(item for item in self.request("bootstrap", client=self.stranger)["activities"] if item["id"] == self.a.pk)
        self.assertEqual((registered["registered"], registered["waitlisted"], registered["taken"]), (1, 0, 1))
        self.assertEqual((waiting["registered"], waiting["waitlisted"], waiting["waitlist_position"]), (0, 1, 1))
