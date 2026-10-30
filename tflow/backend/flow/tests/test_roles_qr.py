from datetime import timedelta
from django.test import Client, TestCase, override_settings
from flow.models import Activity, CheckIn, Event, EventRegistration, Notification, Registration, Room, User
from .test_api import ConcurrencyTests, FAST_HASHER, Scenario
from flow.serializers import milliseconds


@override_settings(PASSWORD_HASHERS=FAST_HASHER)
class RoleAndPassTests(Scenario, TestCase):
    @override_settings(DEBUG=True)
    def test_demo_entrypoints_removed_even_in_development(self):
        self.assertEqual(Client().post("/demo-login/").status_code, 404)
        self.assertNotContains(Client().get("/login/"), "Демо-")
        self.request("demo", "post", status=404, code="NOT_FOUND")

    def test_participant_cannot_create_events_or_seed_demo(self):
        self.request("events", "post", self.event_body(), client=self.participant, status=403, code="FORBIDDEN")
        self.request("demo", "post", client=self.participant, status=404, code="NOT_FOUND")

    def test_role_guard_even_if_participant_is_event_owner(self):
        self.event.owner = self.person
        self.event.save(update_fields=["owner"])
        self.request(f"events/{self.event.pk}/publish", "post", client=self.participant, status=403, code="FORBIDDEN")
        self.request(f"events/{self.event.pk}/attendance", client=self.participant, status=403, code="FORBIDDEN")

    def test_profile_cannot_change_role_or_pass(self):
        self.request("profile", "patch", {"name": "Участник", "city": "Москва", "about": "", "interests": "", "role": "organizer", "pass_token": str(self.owner.pass_token)}, client=self.participant)
        self.person.refresh_from_db()
        self.assertEqual(self.person.role, "participant")
        self.assertNotEqual(self.person.pass_token, self.owner.pass_token)

    def test_role_selected_at_signup(self):
        client = Client()
        password = "Unrelated-new-strong-44!"
        response = client.post("/register/", {"role": "organizer", "email": "host@example.test", "first_name": "Новый", "last_name": "Организатор", "password1": password, "password2": password})
        self.assertEqual(response.status_code, 302)
        self.assertEqual(client.get("/api/auth/me").json()["user"]["role"], "organizer")

    def test_qr_image_is_private_and_real_png(self):
        self.request("profile/qr", client=Client(), status=401)
        result = self.participant.get("/api/profile/qr")
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result["Content-Type"], "image/png")
        self.assertTrue(result.content.startswith(b"\x89PNG\r\n\x1a\n"))
        self.assertIn("private", result["Cache-Control"])
        self.assertNotIn(self.person.email.encode(), result.content)

    def test_one_click_event_registration_is_idempotent(self):
        self.publish()
        path = f"events/{self.event.pk}/registration"
        self.request(path, "post", client=self.participant)
        self.request(path, "post", client=self.participant)
        self.assertEqual(self.event.enrollments.count(), 1)
        state = self.request("bootstrap", client=self.participant)
        self.assertEqual(state["tickets"][0]["id"], self.event.pk)
        self.assertEqual(state["tickets"][0]["enrolled"], 1)

    def test_event_capacity_and_closed_registration(self):
        self.publish()
        self.event.capacity = 1
        self.event.save(update_fields=["capacity"])
        self.request(f"events/{self.event.pk}/registration", "post", client=self.participant)
        self.request(f"events/{self.event.pk}/registration", "post", client=self.stranger, status=409, code="NO_SEATS")
        self.request(f"events/{self.event.pk}/registration", "delete", client=self.participant)
        self.assertEqual(self.event.enrollments.count(), 0)
        self.request(f"events/{self.event.pk}/registration", "post", client=self.stranger)

    def test_activity_registration_also_creates_event_ticket(self):
        self.publish()
        self.request(f"activities/{self.a.pk}/registration", "post", client=self.participant)
        self.assertTrue(EventRegistration.objects.filter(user=self.person, event=self.event).exists())

    def test_cancel_ticket_cancels_only_own_programme(self):
        self.publish()
        for client in [self.participant, self.stranger]:
            self.request(f"activities/{self.c.pk}/registration", "post", client=client)
        self.request(f"events/{self.event.pk}/registration", "delete", client=self.participant)
        self.assertFalse(Registration.objects.filter(user=self.person).exists())
        self.assertTrue(Registration.objects.filter(user=self.other).exists())

    def test_admitted_scan_and_repeat_do_not_double_count(self):
        self.publish()
        self.request(f"events/{self.event.pk}/registration", "post", client=self.participant)
        body = {"qr": f"https://example.test/#pass/{self.person.pass_token}"}
        first = self.request(f"events/{self.event.pk}/check-in", "post", body)
        second = self.request(f"events/{self.event.pk}/check-in", "post", body)
        self.assertTrue(first["admitted"])
        self.assertFalse(first["already_checked_in"])
        self.assertTrue(second["already_checked_in"])
        self.assertEqual(first["checked_in_at"], second["checked_in_at"])
        self.assertEqual(self.event.check_ins.count(), 1)
        detail = self.request(f"events/{self.event.pk}")
        self.assertEqual(detail["event"]["checked_in_count"], 1)
        self.assertEqual(detail["event"]["participant_count"], 1)
        roster = self.request(f"events/{self.event.pk}/attendance")
        self.assertEqual(roster[0]["id"], self.person.pk)
        self.assertIsNotNone(roster[0]["checked_in_at"])

    def test_no_registration_denies_entry_without_personal_info(self):
        result = self.request(f"events/{self.event.pk}/check-in", "post", {"qr": str(self.person.pass_token)}, status=409, code="NOT_REGISTERED")
        self.assertNotIn("attendee", result)
        self.assertNotIn(self.person.email, str(result))
        self.assertEqual(CheckIn.objects.count(), 0)

    def test_registration_at_different_event_does_not_admit(self):
        other = Event.objects.create(owner=self.owner, title="Другое событие", description="Другое", starts_at=self.start, ends_at=self.start+timedelta(hours=4), city="Москва", venue="Зал", format="Очно", topic="Наука", kind="Встреча", status="published")
        EventRegistration.objects.create(user=self.person, event=other)
        self.request(f"events/{self.event.pk}/check-in", "post", {"qr": str(self.person.pass_token)}, status=409, code="NOT_REGISTERED")

    def test_scanner_and_attendee_data_require_event_owner(self):
        self.publish()
        EventRegistration.objects.create(user=self.person, event=self.event)
        body = {"qr": str(self.person.pass_token)}
        for client in [self.participant, self.stranger]:
            self.request(f"events/{self.event.pk}/check-in", "post", body, client=client, status=403, code="FORBIDDEN")
        unrelated = User.objects.create_user("other-host@example.test", None, name="Другой организатор", role="organizer")
        outsider = Client(); outsider.force_login(unrelated)
        self.request(f"events/{self.event.pk}/check-in", "post", body, client=outsider, status=403, code="FORBIDDEN")
        self.request(f"events/{self.event.pk}/attendee?qr={self.person.pass_token}", client=self.participant, status=403)
        person = self.request(f"events/{self.event.pk}/attendee?qr={self.person.pass_token}")
        self.assertEqual(person["email"], self.person.email)
        self.assertNotIn("pass_token", person)

    def test_invalid_qr_is_rejected(self):
        for qr in ["not-a-code", None, "https://example.test/profile/", "http://[broken/#pass/123", f"javascript://example/#pass/{self.person.pass_token}", "x"*2050]:
            self.request(f"events/{self.event.pk}/check-in", "post", {"qr": qr}, status=400, code="INVALID_QR")

    def test_cancel_after_entry_preserves_admission_history(self):
        EventRegistration.objects.create(user=self.person, event=self.event)
        self.request(f"events/{self.event.pk}/check-in", "post", {"qr": str(self.person.pass_token)})
        self.request(f"events/{self.event.pk}/registration", "delete", client=self.participant, status=409, code="ALREADY_CHECKED_IN")
        self.assertEqual(CheckIn.objects.count(), 1)
        self.assertEqual(EventRegistration.objects.count(), 1)

    def test_move_event_shifts_programme_and_notifies_ticket_holders(self):
        self.publish()
        EventRegistration.objects.create(user=self.person, event=self.event)
        Registration.objects.create(user=self.other, activity=self.a)
        delta = timedelta(days=3)
        body = {"starts_at": milliseconds(self.start+delta), "ends_at": milliseconds(self.event.ends_at+delta), "city": "Казань", "venue": "Новая площадка", "address": "Новый адрес"}
        self.request(f"events/{self.event.pk}/move", "patch", body)
        self.event.refresh_from_db(); self.a.refresh_from_db()
        self.assertEqual(self.a.starts_at, self.start+delta)
        self.assertEqual(self.event.city, "Казань")
        self.assertEqual(Notification.objects.count(), 2)
        ticket = self.request("bootstrap", client=self.participant)["tickets"][0]
        self.assertEqual(ticket["starts_at"], milliseconds(self.start+delta))

    def test_move_conflict_rolls_back_event_and_programme(self):
        Registration.objects.create(user=self.person, activity=self.a)
        other = Event.objects.create(owner=self.owner, title="Другое событие", description="Другое", starts_at=self.start+timedelta(days=1), ends_at=self.start+timedelta(days=1,hours=5), city="Москва", venue="Зал", format="Очно", topic="Наука", kind="Встреча", status="published")
        room = Room.objects.create(event=other, name="Зал", capacity=5)
        external = Activity.objects.create(event=other, room=room, title="Другая активность", starts_at=other.starts_at, ends_at=other.starts_at+timedelta(hours=1), capacity=5)
        Registration.objects.create(user=self.person, activity=external)
        body = {"starts_at": milliseconds(other.starts_at), "ends_at": milliseconds(other.starts_at+timedelta(hours=9)), "city": "Казань", "venue": "Новая площадка"}
        self.request(f"events/{self.event.pk}/move", "patch", body, status=409, code="ENROLLED_CONFLICT")
        self.event.refresh_from_db(); self.a.refresh_from_db()
        self.assertEqual(self.event.starts_at, self.start)
        self.assertEqual(self.a.starts_at, self.start)
        self.assertEqual(Notification.objects.count(), 0)


class AttendanceConcurrencyTests(ConcurrencyTests):
    def test_twenty_event_registrations_for_one_place(self):
        self.publish()
        self.event.capacity = 1
        self.event.save(update_fields=["capacity"])
        from concurrent.futures import ThreadPoolExecutor
        from threading import Barrier
        from django.db import close_old_connections, connections
        clients = []
        for index in range(20):
            user = User.objects.create_user(f"enrollment-{index}@example.test", None, name=f"Участник {index}")
            client = Client(); client.force_login(user); clients.append(client)
        barrier = Barrier(20)
        def attempt(client):
            close_old_connections()
            try:
                barrier.wait(timeout=15)
                result = client.post(f"/api/events/{self.event.pk}/registration", data="{}", content_type="application/json")
                return result.status_code, result.json()
            finally:
                connections.close_all()
        with ThreadPoolExecutor(max_workers=20) as pool:
            results = list(pool.map(attempt, clients))
        self.assertEqual(sum(status == 200 for status,_ in results), 1, results)
        self.assertEqual(sum(status == 409 and data.get("code") == "NO_SEATS" for status,data in results), 19, results)
        self.assertEqual(self.event.enrollments.count(), 1)

    def test_twenty_scans_create_one_entry(self):
        self.publish()
        EventRegistration.objects.create(user=self.person, event=self.event)
        clients = []
        for _ in range(20):
            client = Client(); client.force_login(self.owner); clients.append(client)
        from concurrent.futures import ThreadPoolExecutor
        from threading import Barrier
        from django.db import close_old_connections, connections
        barrier = Barrier(20)
        def attempt(client):
            close_old_connections()
            try:
                barrier.wait(timeout=15)
                response = client.post(f"/api/events/{self.event.pk}/check-in", data={"qr": str(self.person.pass_token)}, content_type="application/json")
                return response.status_code, response.json()
            finally:
                connections.close_all()
        with ThreadPoolExecutor(max_workers=20) as pool:
            results = list(pool.map(attempt, clients))
        self.assertTrue(all(status==200 for status,_ in results), results)
        self.assertEqual(sum(not data["already_checked_in"] for _,data in results), 1)
        self.assertEqual(CheckIn.objects.count(), 1)
