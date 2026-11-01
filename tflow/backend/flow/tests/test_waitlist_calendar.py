from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier
from django.db import close_old_connections, connections
from django.test import Client, TestCase, TransactionTestCase, override_settings
from django.utils import timezone
from flow.models import EventRegistration, Notification, Registration, User, WaitlistEntry
from .test_api import FAST_HASHER, Scenario


@override_settings(PASSWORD_HASHERS=FAST_HASHER)
class WaitlistTests(Scenario, TestCase):
    def fill_and_wait(self):
        self.publish()
        self.request(f"activities/{self.a.pk}/registration", "post", client=self.participant)
        self.request(f"activities/{self.a.pk}/waitlist", "post", client=self.stranger)

    def test_queue_position_is_private_and_join_is_idempotent(self):
        self.fill_and_wait()
        path = f"activities/{self.a.pk}/waitlist"
        self.request(path, "post", client=self.stranger)
        self.assertEqual(WaitlistEntry.objects.count(), 1)
        self.assertTrue(EventRegistration.objects.filter(user=self.other, event=self.event).exists())
        state = self.request("bootstrap", client=self.stranger)
        self.assertEqual(state["schedule"], [])
        self.assertEqual(state["waitlist"][0]["waitlist_position"], 1)
        self.assertEqual(state["waitlist"][0]["taken"], 1)
        self.assertEqual(state["waitlist"][0]["waiting_count"], 1)
        self.assertEqual(self.request("bootstrap", client=self.participant)["waitlist"], [])
        public = next(a for a in self.request(f"events/{self.event.pk}", client=Client())["activities"] if a["id"] == self.a.pk)
        self.assertEqual(public["waiting_count"], 1)
        self.assertEqual(public["waitlist_position"], 0)
        self.assertNotIn(self.other.email, str(public))

    def test_cancel_promotes_and_notifies_exactly_once(self):
        self.fill_and_wait()
        path = f"activities/{self.a.pk}/registration"
        self.request(path, "delete", client=self.participant)
        self.request(path, "delete", client=self.participant)
        self.assertEqual(self.a.registrations.count(), 1)
        self.assertTrue(self.a.registrations.filter(user=self.other).exists())
        self.assertFalse(WaitlistEntry.objects.exists())
        self.assertEqual(Notification.objects.filter(user=self.other, title="Вы записаны из листа ожидания").count(), 1)
        self.assertEqual(self.request("bootstrap", client=self.stranger)["schedule"][0]["id"], self.a.pk)

    def test_fifo_and_capacity_increase(self):
        self.fill_and_wait()
        third = User.objects.create_user("third@example.test", None, name="Третий")
        client = Client(); client.force_login(third)
        self.request(f"activities/{self.a.pk}/waitlist", "post", client=client)
        self.assertEqual(self.request("bootstrap", client=client)["waitlist"][0]["waitlist_position"], 2)
        self.request(f"activities/{self.a.pk}", "patch", self.activity_body(self.a, capacity=2))
        self.assertTrue(self.a.registrations.filter(user=self.other).exists())
        self.assertFalse(self.a.registrations.filter(user=third).exists())
        self.assertEqual(self.request("bootstrap", client=client)["waitlist"][0]["waitlist_position"], 1)

    def test_conflicting_person_keeps_position_and_next_eligible_is_promoted(self):
        self.fill_and_wait()
        self.request(f"activities/{self.b.pk}/registration", "post", client=self.stranger)
        third = User.objects.create_user("eligible@example.test", None, name="Свободный участник")
        client = Client(); client.force_login(third)
        self.request(f"activities/{self.a.pk}/waitlist", "post", client=client)
        self.request(f"activities/{self.a.pk}/registration", "delete", client=self.participant)
        self.assertTrue(self.a.registrations.filter(user=third).exists())
        self.assertTrue(self.a.waitlist.filter(user=self.other).exists())
        self.assertFalse(self.a.registrations.filter(user=self.other).exists())
        self.assertFalse(Notification.objects.filter(user=self.other, title="Вы записаны из листа ожидания").exists())

    def test_cancelling_conflict_retries_a_free_queued_seat(self):
        self.fill_and_wait()
        self.request(f"activities/{self.b.pk}/registration", "post", client=self.stranger)
        self.request(f"activities/{self.a.pk}/registration", "delete", client=self.participant)
        self.assertEqual(self.a.registrations.count(), 0)
        self.request(f"activities/{self.b.pk}/registration", "delete", client=self.stranger)
        self.assertTrue(self.a.registrations.filter(user=self.other).exists())
        self.assertEqual(self.other.registrations.count(), 1)

    def test_event_cancellation_promotes_but_clears_only_own_queue(self):
        self.fill_and_wait()
        self.request(f"events/{self.event.pk}/registration", "delete", client=self.participant)
        self.assertTrue(self.a.registrations.filter(user=self.other).exists())
        self.request(f"activities/{self.a.pk}/waitlist", "post", client=self.participant)
        self.request(f"events/{self.event.pk}/registration", "delete", client=self.participant)
        self.assertFalse(WaitlistEntry.objects.filter(user=self.person).exists())
        self.assertTrue(self.a.registrations.filter(user=self.other).exists())

    def test_leaving_does_not_cancel_ticket_or_another_persons_queue(self):
        self.fill_and_wait()
        path = f"activities/{self.a.pk}/waitlist"
        self.request(path, "delete", {"user_id": self.other.pk}, client=self.participant)
        self.assertTrue(self.a.waitlist.filter(user=self.other).exists())
        self.request(path, "delete", client=self.stranger)
        self.assertFalse(WaitlistEntry.objects.exists())
        self.assertTrue(EventRegistration.objects.filter(user=self.other, event=self.event).exists())

    def test_no_queue_without_full_activity_or_for_registered_person(self):
        self.publish()
        path = f"activities/{self.a.pk}/waitlist"
        self.request(path, "post", client=self.stranger, status=409, code="SEATS_AVAILABLE")
        self.request(f"activities/{self.a.pk}/registration", "post", client=self.participant)
        self.request(path, "post", client=self.participant, status=409, code="ALREADY_REGISTERED")

    def test_queue_requires_login_published_programme_and_future_activity(self):
        path = f"activities/{self.a.pk}/waitlist"
        self.request(path, "post", client=Client(), status=401)
        self.request(path, "post", client=self.stranger, status=409, code="NOT_PUBLISHED")
        self.publish()
        self.a.starts_at = timezone.now() - timedelta(minutes=1)
        self.a.save(update_fields=["starts_at"])
        self.request(path, "post", client=self.stranger, status=409, code="REGISTRATION_CLOSED")
        self.assertFalse(WaitlistEntry.objects.exists())

    def test_queue_rejects_known_conflict_and_event_capacity_limit(self):
        self.publish()
        self.request(f"activities/{self.a.pk}/registration", "post", client=self.participant)
        self.request(f"activities/{self.b.pk}/registration", "post", client=self.stranger)
        self.request(f"activities/{self.a.pk}/waitlist", "post", client=self.stranger, status=409, code="PARTICIPANT_CONFLICT")
        self.request(f"activities/{self.b.pk}/registration", "delete", client=self.stranger)
        EventRegistration.objects.filter(user=self.other).delete()
        self.event.capacity = 1
        self.event.save(update_fields=["capacity"])
        self.request(f"activities/{self.a.pk}/waitlist", "post", client=self.stranger, status=409, code="NO_SEATS")
        self.assertFalse(WaitlistEntry.objects.exists())

    def test_closed_activity_and_inactive_user_are_not_promoted(self):
        self.fill_and_wait()
        self.other.is_active = False; self.other.save(update_fields=["is_active"])
        self.request(f"activities/{self.a.pk}/registration", "delete", client=self.participant)
        self.assertFalse(self.a.registrations.exists())
        self.other.is_active = True; self.other.save(update_fields=["is_active"])
        self.a.starts_at = timezone.now() - timedelta(minutes=1); self.a.save(update_fields=["starts_at"])
        self.request(f"activities/{self.a.pk}", "patch", self.activity_body(self.a, starts_at=int(self.start.timestamp()*1000), capacity=2))
        # The move back to a valid future slot makes the queued participant eligible.
        self.assertTrue(self.a.registrations.filter(user=self.other).exists())

    def test_new_registration_cannot_jump_eligible_queue(self):
        self.fill_and_wait()
        Registration.objects.filter(user=self.person, activity=self.a).delete()
        self.request(f"activities/{self.a.pk}/registration", "post", client=self.participant, status=409, code="NO_SEATS")
        self.assertTrue(self.a.registrations.filter(user=self.other).exists())
        self.assertFalse(self.a.waitlist.exists())


@override_settings(PASSWORD_HASHERS=FAST_HASHER)
class CalendarTests(Scenario, TestCase):
    def test_event_calendar_uses_utc_and_alarm_and_stable_uid(self):
        self.publish()
        path = f"/api/events/{self.event.pk}/calendar"
        response = Client().get(path)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "text/calendar; charset=utf-8")
        self.assertIn("attachment", response["Content-Disposition"])
        value = response.content.decode()
        self.assertIn("DTSTART:" + self.start.strftime("%Y%m%dT%H%M%SZ"), value)
        self.assertIn("TRIGGER:-PT30M", value)
        self.assertIn("Конференция", value)
        self.assertEqual(value.count("BEGIN:VEVENT"), 1)
        self.assertEqual(response.content, Client().get(path).content)

    def test_draft_calendar_is_owner_only(self):
        path = f"/api/events/{self.event.pk}/calendar"
        self.assertEqual(Client().get(path).status_code, 404)
        self.assertEqual(self.participant.get(path).status_code, 404)
        self.assertEqual(self.client.get(path).status_code, 200)

    def test_schedule_is_private_and_excludes_queue(self):
        self.publish()
        self.request(f"activities/{self.a.pk}/registration", "post", client=self.participant)
        self.request(f"activities/{self.a.pk}/waitlist", "post", client=self.stranger)
        self.request(f"activities/{self.c.pk}/registration", "post", client=self.stranger)
        path = "/api/schedule/calendar"
        self.assertEqual(Client().get(path).status_code, 401)
        response = self.stranger.get(path)
        value = response.content.decode()
        self.assertIn("SUMMARY:Лекция C", value)
        self.assertNotIn("SUMMARY:Лекция A", value)
        self.assertIn("Зал 1", value)
        self.assertEqual(value.count("BEGIN:VEVENT"), 1)
        self.assertIn("private", response["Cache-Control"])

    def test_utf8_folding_and_text_escaping_prevent_calendar_injection(self):
        self.publish()
        self.event.title = "Очень длинное название " * 6
        self.event.description = "Строка, точка; слеш \\\nBEGIN:VEVENT\r\nSUMMARY:Подмена"
        self.event.save()
        value = Client().get(f"/api/events/{self.event.pk}/calendar").content.decode()
        self.assertTrue(all(len(line.encode()) <= 75 for line in value.split("\r\n")))
        unfolded = value.replace("\r\n ", "")
        self.assertEqual(unfolded.count("\r\nBEGIN:VEVENT\r\n"), 1)
        self.assertIn("Строка\\, точка\\; слеш \\\\\\nBEGIN:VEVENT\\nSUMMARY:Подмена", unfolded)
        self.assertEqual(value.replace("\r\n", "").count("\n"), 0)


@override_settings(PASSWORD_HASHERS=FAST_HASHER)
class WaitlistConcurrencyTests(Scenario, TransactionTestCase):
    reset_sequences = True

    def test_cancellation_and_twenty_queue_joins_do_not_overbook(self):
        self.publish()
        self.request(f"activities/{self.a.pk}/registration", "post", client=self.participant)
        first = User.objects.create_user("first-queue@example.test", None, name="Первый в очереди")
        first_client = Client(); first_client.force_login(first)
        self.request(f"activities/{self.a.pk}/waitlist", "post", client=first_client)
        clients = []
        for i in range(20):
            person = User.objects.create_user(f"queue-{i}@example.test", None, name=f"Участник {i}")
            client = Client(); client.force_login(person); clients.append(client)
        barrier = Barrier(21)
        def attempt(pair):
            client, cancel = pair
            close_old_connections()
            try:
                barrier.wait(timeout=20)
                path = f"/api/activities/{self.a.pk}/" + ("registration" if cancel else "waitlist")
                response = (client.delete if cancel else client.post)(path, data="{}", content_type="application/json")
                return response.status_code, response.json()
            finally:
                connections.close_all()
        with ThreadPoolExecutor(max_workers=21) as pool:
            results = list(pool.map(attempt, [(c, False) for c in clients] + [(self.participant, True)]))
        self.assertTrue(all(status == 200 for status, _ in results), results)
        self.assertEqual(self.a.registrations.count(), 1)
        self.assertTrue(self.a.registrations.filter(user=first).exists())
        self.assertEqual(self.a.waitlist.count(), 20)
        self.assertEqual(Notification.objects.filter(user=first, title="Вы записаны из листа ожидания").count(), 1)
