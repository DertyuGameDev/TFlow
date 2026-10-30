"""EventFlow sections 5 and 8: boundary cases and concurrent schedule writes."""
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier

from django.db import close_old_connections, connections
from django.test import TestCase, TransactionTestCase, override_settings

from flow.models import Activity, Community, Event, EventRegistration, Notification, Registration, Room
from flow.serializers import milliseconds
from .test_api import FAST_HASHER, Scenario


@override_settings(PASSWORD_HASHERS=FAST_HASHER)
class SpecConflictTests(Scenario, TestCase):
    def test_public_program_is_sorted_by_start_time(self):
        self.publish()
        program = self.request(f"events/{self.event.pk}")["activities"]
        self.assertEqual([(a["starts_at"], a["id"]) for a in program],
                         sorted((a["starts_at"], a["id"]) for a in program))

    def test_edit_preserves_event_capacity_when_optional_field_is_omitted(self):
        Event.objects.filter(pk=self.event.pk).update(capacity=1000)
        self.request(f"events/{self.event.pk}", "patch", self.event_body(title="Новое название"))
        self.event.refresh_from_db()
        self.assertEqual(self.event.capacity, 1000)
        self.assertEqual(self.event.title, "Новое название")

    def test_create_still_defaults_event_capacity(self):
        result = self.request("events", "post", self.event_body(), status=201)
        self.assertEqual(Event.objects.get(pk=result["id"]).capacity, 500)

    def test_edit_preserves_omitted_address_community_and_null_capacity(self):
        community = Community.objects.create(name="Клуб", description="Клуб", topic="Наука", color="blue")
        Event.objects.filter(pk=self.event.pk).update(capacity=1000, address="Улица, дом 1", community=community)
        body = self.event_body(capacity=None)
        body.pop("address")
        self.request(f"events/{self.event.pk}", "patch", body)
        self.event.refresh_from_db()
        self.assertEqual(self.event.capacity, 1000)
        self.assertEqual(self.event.address, "Улица, дом 1")
        self.assertEqual(self.event.community_id, community.pk)

    def test_edit_can_explicitly_clear_optional_text_and_community(self):
        community = Community.objects.create(name="Клуб", description="Клуб", topic="Наука", color="blue")
        Event.objects.filter(pk=self.event.pk).update(address="Старый адрес", community=community)
        self.request(f"events/{self.event.pk}", "patch", self.event_body(address="", community_id=None))
        self.event.refresh_from_db()
        self.assertEqual(self.event.address, "")
        self.assertIsNone(self.event.community_id)

    def test_participant_overlap_boundaries_in_both_directions(self):
        self.publish()
        self.event.activities.exclude(pk__in=[self.a.pk, self.b.pk]).delete()
        Activity.objects.filter(pk=self.a.pk).update(starts_at=self.start+timedelta(hours=1), ends_at=self.start+timedelta(hours=2))
        self.request(f"activities/{self.a.pk}/registration", "post", client=self.participant)
        for start, end, conflict in [(60,120,True), (75,105,True), (30,150,True),
                                     (30,75,True), (105,150,True), (0,60,False), (120,180,False)]:
            with self.subTest(start=start, end=end):
                Activity.objects.filter(pk=self.b.pk).update(starts_at=self.start+timedelta(minutes=start), ends_at=self.start+timedelta(minutes=end))
                self.request(f"activities/{self.b.pk}/registration", "post", client=self.participant,
                             status=409 if conflict else 200, code="PARTICIPANT_CONFLICT" if conflict else None)
                self.request(f"activities/{self.b.pk}/registration", "delete", client=self.participant)
        self.assertEqual(Registration.objects.filter(user=self.person).count(), 1)

    def test_room_overlap_boundaries_in_both_directions(self):
        self.event.activities.exclude(pk=self.a.pk).delete()
        self.a.starts_at, self.a.ends_at = self.start+timedelta(hours=1), self.start+timedelta(hours=2)
        self.a.save()
        for start, end, conflict in [(60,120,True), (75,105,True), (30,150,True),
                                     (30,75,True), (105,150,True), (0,60,False), (120,180,False)]:
            with self.subTest(start=start, end=end):
                body = self.activity_body(self.a, title="Новая лекция", starts_at=milliseconds(self.start+timedelta(minutes=start)), ends_at=milliseconds(self.start+timedelta(minutes=end)))
                result = self.request(f"events/{self.event.pk}/activities", "post", body,
                                      status=409 if conflict else 201, code="ROOM_CONFLICT" if conflict else None)
                if not conflict:
                    Activity.objects.get(pk=result["id"]).delete()

    def external_activity(self, start, end):
        event = Event.objects.create(owner=self.owner, title="Вторая конференция", description="Программа второй конференции",
                                     starts_at=self.start, ends_at=self.start+timedelta(hours=9), city="Москва", venue="Зал",
                                     format="Очно", topic="Наука", kind="Встреча", status="published")
        room = Room.objects.create(event=event, name="Внешняя аудитория", capacity=10)
        return Activity.objects.create(event=event, room=room, title="Внешняя лекция",
                                       starts_at=start, ends_at=end, capacity=10)

    def test_activity_conflicts_apply_across_events_without_orphan_ticket(self):
        self.publish()
        external = self.external_activity(self.start+timedelta(minutes=30), self.start+timedelta(minutes=90))
        self.request(f"activities/{self.a.pk}/registration", "post", client=self.participant)
        self.request(f"activities/{external.pk}/registration", "post", client=self.participant,
                     status=409, code="PARTICIPANT_CONFLICT")
        self.assertFalse(EventRegistration.objects.filter(user=self.person, event=external.event).exists())
        self.assertEqual(Registration.objects.filter(user=self.person).count(), 1)

    def test_event_tickets_are_not_activity_time_reservations(self):
        self.publish()
        external = self.external_activity(self.start, self.start+timedelta(hours=1))
        for event_id in [self.event.pk, external.event_id]:
            self.request(f"events/{event_id}/registration", "post", client=self.participant)
        self.assertEqual(EventRegistration.objects.filter(user=self.person).count(), 2)
        self.assertEqual(Registration.objects.filter(user=self.person).count(), 0)

    def test_move_to_busy_room_rolls_back_fields_and_registrations(self):
        self.publish()
        self.request(f"activities/{self.b.pk}/registration", "post", client=self.participant)
        before = Activity.objects.values().get(pk=self.b.pk)
        self.request(f"activities/{self.b.pk}", "patch", self.activity_body(self.b, room_id=self.r1.pk, title="Изменённая лекция"),
                     status=409, code="ROOM_CONFLICT")
        self.assertEqual(Activity.objects.values().get(pk=self.b.pk), before)
        self.assertTrue(Registration.objects.filter(user=self.person, activity=self.b).exists())
        self.assertFalse(Notification.objects.exists())

    def test_move_checks_every_registered_person_including_other_events(self):
        self.publish()
        external = self.external_activity(self.start+timedelta(hours=5), self.start+timedelta(hours=6))
        for client in [self.participant, self.stranger]:
            self.request(f"activities/{self.c.pk}/registration", "post", client=client)
        self.request(f"activities/{external.pk}/registration", "post", client=self.stranger)
        before = Activity.objects.values().get(pk=self.c.pk)
        self.request(f"activities/{self.c.pk}", "patch", self.activity_body(self.c,
                     starts_at=milliseconds(external.starts_at), ends_at=milliseconds(external.ends_at)),
                     status=409, code="ENROLLED_CONFLICT")
        self.assertEqual(Activity.objects.values().get(pk=self.c.pk), before)
        self.assertEqual(self.c.registrations.count(), 2)
        self.assertFalse(Notification.objects.exists())

    def test_activity_end_at_event_end_is_allowed_and_exceeding_it_is_rejected(self):
        end = self.event.ends_at
        body = self.activity_body(self.a, starts_at=milliseconds(end-timedelta(hours=1)), ends_at=milliseconds(end))
        self.request(f"activities/{self.a.pk}", "patch", body)
        self.request(f"activities/{self.a.pk}", "patch", {**body, "ends_at":milliseconds(end+timedelta(milliseconds=1))},
                     status=409, code="EVENT_DATES")

    def test_successful_change_updates_room_time_seats_and_notification(self):
        self.publish()
        self.request(f"activities/{self.a.pk}/registration", "post", client=self.participant)
        self.request(f"activities/{self.a.pk}", "patch", self.activity_body(self.a, room_id=self.r2.pk,
                     starts_at=milliseconds(self.start+timedelta(hours=6)), ends_at=milliseconds(self.start+timedelta(hours=7)), capacity=3))
        schedule = self.request("bootstrap", client=self.participant)["schedule"][0]
        self.assertEqual(schedule["room_name"], self.r2.name)
        self.assertEqual(schedule["starts_at"], milliseconds(self.start+timedelta(hours=6)))
        self.assertEqual((schedule["taken"], schedule["capacity"]), (1,3))
        self.assertEqual(Notification.objects.filter(user=self.person).count(), 1)
        self.request(f"activities/{self.a.pk}/registration", "delete", client=self.participant)
        self.assertEqual(self.request("bootstrap", client=self.participant)["schedule"], [])
        self.assertEqual(self.request(f"events/{self.event.pk}")["activities"][-1]["taken"], 0)


@override_settings(PASSWORD_HASHERS=FAST_HASHER)
class ConcurrentScheduleTests(Scenario, TransactionTestCase):
    def race_requests(self, requests):
        barrier = Barrier(len(requests))
        def attempt(item):
            client, method, path, body = item
            close_old_connections()
            try:
                barrier.wait(timeout=15)
                response = getattr(client, method)("/api/"+path, data=body, content_type="application/json")
                return response.status_code, response.json()
            finally:
                connections.close_all()
        with ThreadPoolExecutor(max_workers=len(requests)) as pool:
            return list(pool.map(attempt, requests))

    def test_duplicate_registration_race(self):
        self.publish()
        results = self.race_requests([(self.participant,"post",f"activities/{self.a.pk}/registration",{})] * 2)
        self.assertCountEqual([status for status,_ in results], [200,409])
        self.assertEqual(next(body["code"] for status,body in results if status==409), "ALREADY_REGISTERED")
        self.assertEqual(self.a.registrations.count(), 1)

    def test_registration_racing_capacity_reduction_preserves_limit(self):
        self.publish()
        self.request(f"activities/{self.c.pk}/registration", "post", client=self.participant)
        results = self.race_requests([
            (self.stranger,"post",f"activities/{self.c.pk}/registration",{}),
            (self.client,"patch",f"activities/{self.c.pk}",self.activity_body(self.c,capacity=1)),
        ])
        self.assertCountEqual([status for status,_ in results], [200,409])
        self.assertIn(next(body["code"] for status,body in results if status==409), {"NO_SEATS","BELOW_REGISTERED"})
        self.c.refresh_from_db()
        self.assertLessEqual(self.c.registrations.count(), self.c.capacity)

    def test_registration_racing_move_cannot_introduce_participant_overlap(self):
        self.publish()
        self.request(f"activities/{self.d.pk}/registration", "post", client=self.participant)
        results = self.race_requests([
            (self.participant,"post",f"activities/{self.a.pk}/registration",{}),
            (self.client,"patch",f"activities/{self.a.pk}",self.activity_body(self.a,
             starts_at=milliseconds(self.d.starts_at),ends_at=milliseconds(self.d.ends_at))),
        ])
        self.assertCountEqual([status for status,_ in results], [200,409])
        self.assertIn(next(body["code"] for status,body in results if status==409), {"PARTICIPANT_CONFLICT","ENROLLED_CONFLICT"})
        activities = list(Activity.objects.filter(registrations__user=self.person))
        for index,a in enumerate(activities):
            for b in activities[index+1:]:
                self.assertFalse(a.starts_at < b.ends_at and a.ends_at > b.starts_at)

    def test_cancellation_racing_last_seat_registration_never_overbooks(self):
        self.publish()
        self.request(f"activities/{self.a.pk}/registration", "post", client=self.participant)
        cancelled, enrolled = self.race_requests([
            (self.participant,"delete",f"activities/{self.a.pk}/registration",{}),
            (self.stranger,"post",f"activities/{self.a.pk}/registration",{}),
        ])
        self.assertEqual(cancelled[0], 200)
        self.assertIn(enrolled[0], [200,409])
        if enrolled[0] == 409:
            self.assertEqual(enrolled[1]["code"], "NO_SEATS")
        self.assertFalse(Registration.objects.filter(user=self.person, activity=self.a).exists())
        self.assertLessEqual(self.a.registrations.count(), self.a.capacity)
