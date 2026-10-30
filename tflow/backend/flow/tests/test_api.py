import json
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from io import StringIO
from threading import Barrier
from django.core.management import call_command
from django.db import close_old_connections, connections
from django.test import Client, TestCase, TransactionTestCase, override_settings
from django.utils import timezone
from flow.models import Activity, Community, Event, Notification, Registration, Room, ScheduleLock, User
from flow.serializers import milliseconds

FAST_HASHER = ["django.contrib.auth.hashers.MD5PasswordHasher"]


class Scenario:
    def setUp(self):
        ScheduleLock.objects.get_or_create(pk=1)
        self.owner = User.objects.create_user("owner@example.test", "Local-test-password-42!", name="Организатор")
        self.person = User.objects.create_user("person@example.test", "Local-test-password-42!", name="Участник")
        self.other = User.objects.create_user("other@example.test", "Local-test-password-42!", name="Другой участник")
        self.start = timezone.now().replace(microsecond=0) + timedelta(days=20)
        self.event = Event.objects.create(owner=self.owner, title="Конференция", description="Учебное мероприятие для проверки",
                                          starts_at=self.start, ends_at=self.start + timedelta(hours=9),
                                          city="Мурманск", venue="Учебный центр", format="Очно", topic="Разработка", kind="Конференция")
        self.r1 = Room.objects.create(event=self.event, name="Зал 1", capacity=2)
        self.r2 = Room.objects.create(event=self.event, name="Зал 2", capacity=3)
        self.a = Activity.objects.create(event=self.event, room=self.r1, title="Лекция A", starts_at=self.start, ends_at=self.start + timedelta(hours=1), capacity=1)
        self.b = Activity.objects.create(event=self.event, room=self.r2, title="Лекция B", starts_at=self.start + timedelta(minutes=30), ends_at=self.start + timedelta(minutes=90), capacity=2)
        self.c = Activity.objects.create(event=self.event, room=self.r1, title="Лекция C", starts_at=self.start + timedelta(hours=1), ends_at=self.start + timedelta(hours=2), capacity=2)
        self.d = Activity.objects.create(event=self.event, room=self.r2, title="Лекция D", starts_at=self.start + timedelta(hours=2), ends_at=self.start + timedelta(hours=3), capacity=2)
        self.client = Client()
        self.client.force_login(self.owner)
        self.participant = Client()
        self.participant.force_login(self.person)
        self.stranger = Client()
        self.stranger.force_login(self.other)

    def publish(self):
        self.event.status = "published"
        self.event.save(update_fields=["status"])

    def request(self, path, method="get", body=None, client=None, status=200, code=None):
        client = client or self.client
        options = {} if method == "get" else {"data": json.dumps(body or {}), "content_type": "application/json"}
        result = getattr(client, method)("/api/" + path, **options)
        self.assertEqual(result.status_code, status, result.content)
        data = result.json()
        if code:
            self.assertEqual(data["code"], code)
        return data

    def activity_body(self, activity, **changes):
        data = {"title": activity.title, "description": activity.description, "speaker": activity.speaker,
                "room_id": activity.room_id, "starts_at": milliseconds(activity.starts_at), "ends_at": milliseconds(activity.ends_at), "capacity": activity.capacity}
        return {**data, **changes}

    def event_body(self, **changes):
        return {**{key: getattr(self.event, key) for key in ["title", "description", "city", "venue", "address", "format", "topic", "kind", "cover"]},
                "starts_at": milliseconds(self.event.starts_at), "ends_at": milliseconds(self.event.ends_at), **changes}


@override_settings(PASSWORD_HASHERS=FAST_HASHER)
class ApiTests(Scenario, TestCase):
    def test_health_and_anonymous_catalog(self):
        self.assertEqual(self.request("health")["backend"], "django")
        self.assertEqual(self.request("bootstrap", client=Client())["events"], [])
        self.publish()
        self.assertEqual(len(self.request("bootstrap", client=Client())["events"]), 1)

    def test_header_identity_is_not_trusted(self):
        result = Client().get("/api/auth/me", HTTP_OAI_AUTHENTICATED_USER_ID=self.owner.pk, HTTP_OAI_AUTHENTICATED_USER_EMAIL=self.owner.email)
        self.assertIsNone(result.json()["user"])
        self.request("events", "post", self.event_body(), client=Client(), status=401, code="UNAUTHORIZED")

    def test_create_event_and_publish(self):
        result = self.request("events", "post", self.event_body(title="Новое мероприятие"), status=201)
        event = Event.objects.get(pk=result["id"])
        self.assertEqual(event.owner, self.owner)
        self.assertEqual(event.status, "draft")
        self.request(f"events/{event.pk}/publish", "post", status=400, code="EMPTY_PROGRAM")
        self.request(f"events/{self.event.pk}/publish", "post")
        self.event.refresh_from_db()
        self.assertEqual(self.event.status, "published")

    def test_event_invalid_dates(self):
        self.request("events", "post", self.event_body(ends_at=milliseconds(self.start)-1), status=400, code="VALIDATION")

    def test_event_dates_cannot_exclude_activities(self):
        self.request(f"events/{self.event.pk}", "patch", self.event_body(ends_at=milliseconds(self.start + timedelta(hours=1))), status=409, code="EVENT_DATES")

    def test_ownership_all_administrative_endpoints(self):
        event_id = self.event.pk
        for path, method, body in [
            (f"events/{event_id}", "patch", self.event_body()),
            (f"events/{event_id}/rooms", "post", {"name": "Чужой зал", "capacity": 30}),
            (f"events/{event_id}/activities", "post", self.activity_body(self.a)),
            (f"events/{event_id}/publish", "post", {}),
            (f"rooms/{self.r1.pk}", "patch", {"name": "Чужой зал", "capacity": 30}),
            (f"activities/{self.a.pk}", "patch", self.activity_body(self.a)),
            (f"events/{event_id}/participants", "get", None),
        ]:
            with self.subTest(path=path):
                self.request(path, method, body, client=self.participant, status=403, code="FORBIDDEN")

    def test_private_draft_not_exposed(self):
        self.request(f"events/{self.event.pk}", client=self.participant, status=404)
        self.request(f"events/{self.event.pk}/bookmark", "post", client=self.participant, status=404)

    def test_create_and_edit_room(self):
        response = self.request(f"events/{self.event.pk}/rooms", "post", {"name": "Зал 3", "capacity": 50}, status=201)
        self.request(f"rooms/{response['id']}", "patch", {"name": "Большой зал", "capacity": 60})
        self.assertEqual(Room.objects.get(pk=response["id"]).capacity, 60)

    def test_room_cannot_shrink_below_activity_capacity(self):
        self.request(f"rooms/{self.r1.pk}", "patch", {"name": "Малый зал", "capacity": 1}, status=409, code="ROOM_CAPACITY")

    def test_room_overlap_rejected(self):
        body = self.activity_body(self.a, title="Другая активность", starts_at=milliseconds(self.start+timedelta(minutes=20)))
        self.request(f"events/{self.event.pk}/activities", "post", body, status=409, code="ROOM_CONFLICT")

    def test_room_from_another_event_rejected(self):
        other = Event.objects.create(owner=self.owner, title="Другое", description="Другое событие", starts_at=self.start, ends_at=self.start+timedelta(hours=4), city="Мурманск", venue="Площадка", format="Очно", kind="Встреча", topic="Наука")
        room = Room.objects.create(event=other, name="Чужая комната", capacity=50)
        self.request(f"activities/{self.a.pk}", "patch", self.activity_body(self.a, room_id=room.pk), status=400, code="INVALID_REFERENCE")

    def test_activity_capacity_and_bounds(self):
        self.request(f"events/{self.event.pk}/activities", "post", self.activity_body(self.a, capacity=3), status=409, code="ROOM_CAPACITY")
        self.request(f"events/{self.event.pk}/activities", "post", self.activity_body(self.a, starts_at=milliseconds(self.start-timedelta(hours=1))), status=409, code="EVENT_DATES")

    def test_registration_requires_published_future_event(self):
        self.request(f"activities/{self.a.pk}/registration", "post", client=self.participant, status=409, code="NOT_PUBLISHED")
        self.publish()
        Activity.objects.filter(pk=self.a.pk).update(starts_at=timezone.now()-timedelta(hours=1))
        self.request(f"activities/{self.a.pk}/registration", "post", client=self.participant, status=409, code="REGISTRATION_CLOSED")

    def test_duplicate_registration(self):
        self.publish()
        self.request(f"activities/{self.a.pk}/registration", "post", client=self.participant)
        self.request(f"activities/{self.a.pk}/registration", "post", client=self.participant, status=409, code="ALREADY_REGISTERED")
        self.assertEqual(Registration.objects.count(), 1)

    def test_last_seat_and_cancellation(self):
        self.publish()
        self.request(f"activities/{self.a.pk}/registration", "post", client=self.participant)
        self.request(f"activities/{self.a.pk}/registration", "post", client=self.stranger, status=409, code="NO_SEATS")
        self.request(f"activities/{self.a.pk}/registration", "delete", client=self.participant)
        self.request(f"activities/{self.a.pk}/registration", "post", client=self.stranger)

    def test_cancellation_cannot_target_another_user(self):
        self.publish()
        self.request(f"activities/{self.a.pk}/registration", "post", client=self.participant)
        self.request(f"activities/{self.a.pk}/registration", "delete", {"user_id": self.person.pk}, client=self.stranger)
        self.assertTrue(Registration.objects.filter(user=self.person, activity=self.a).exists())

    def test_overlap_blocked_adjacent_allowed(self):
        self.publish()
        self.request(f"activities/{self.a.pk}/registration", "post", client=self.participant)
        self.request(f"activities/{self.b.pk}/registration", "post", client=self.participant, status=409, code="PARTICIPANT_CONFLICT")
        self.request(f"activities/{self.c.pk}/registration", "post", client=self.participant)
        self.assertEqual(Registration.objects.filter(user=self.person).count(), 2)

    def test_move_with_participant_conflict_rolls_back(self):
        self.publish()
        Registration.objects.create(user=self.person, activity=self.c)
        Registration.objects.create(user=self.person, activity=self.d)
        body = self.activity_body(self.d, starts_at=milliseconds(self.start+timedelta(minutes=90)))
        self.request(f"activities/{self.d.pk}", "patch", body, status=409, code="ENROLLED_CONFLICT")
        self.d.refresh_from_db()
        self.assertEqual(self.d.starts_at, self.start+timedelta(hours=2))
        self.assertEqual(Notification.objects.count(), 0)

    def test_room_move_conflict_rolls_back(self):
        self.request(f"activities/{self.c.pk}", "patch", self.activity_body(self.c, starts_at=milliseconds(self.start+timedelta(minutes=30))), status=409, code="ROOM_CONFLICT")

    def test_capacity_not_below_enrolled(self):
        Registration.objects.bulk_create([Registration(user=self.person, activity=self.c), Registration(user=self.other, activity=self.c)])
        self.request(f"activities/{self.c.pk}", "patch", self.activity_body(self.c, capacity=1), status=409, code="BELOW_REGISTERED")

    def test_live_schedule_and_notification_after_move(self):
        self.publish()
        Registration.objects.create(user=self.person, activity=self.a)
        self.request(f"activities/{self.a.pk}", "patch", self.activity_body(self.a, title="Новое название", room_id=self.r2.pk,
                     starts_at=milliseconds(self.start+timedelta(hours=5)), ends_at=milliseconds(self.start+timedelta(hours=6))))
        data = self.request("bootstrap", client=self.participant)
        self.assertEqual(data["schedule"][0]["title"], "Новое название")
        self.assertEqual(data["schedule"][0]["room_name"], "Зал 2")
        self.assertEqual(data["schedule"][0]["taken"], 1)
        self.assertEqual(len(data["notifications"]), 1)
        self.request("notifications", "patch", client=self.stranger)
        self.assertFalse(Notification.objects.get(user=self.person).read)
        self.request("notifications", "patch", client=self.participant)
        self.assertTrue(Notification.objects.get(user=self.person).read)

    def test_profile_bookmark_and_community(self):
        self.publish()
        Community.objects.create(pk="ai", name="AI", description="Сообщество", topic="AI", color="blue")
        self.request("profile", "patch", {"name": "Новое имя", "city": "Казань", "about": "О себе", "interests": "AI"}, client=self.participant)
        self.request(f"events/{self.event.pk}/bookmark", "post", client=self.participant)
        self.request("communities/ai/join", "post", client=self.participant)
        data = self.request("bootstrap", client=self.participant)
        self.assertEqual(data["profile"]["name"], "Новое имя")
        self.assertEqual(data["events"][0]["saved"], 1)
        self.assertEqual(data["communities"][0]["joined"], 1)
        self.assertEqual(self.request("bootstrap", client=self.stranger)["events"][0]["saved"], 0)
        self.request(f"events/{self.event.pk}/bookmark", "delete", client=self.participant)
        self.request("communities/ai/join", "delete", client=self.participant)

    def test_participant_count_remains_total_in_personal_schedule(self):
        self.publish()
        Registration.objects.create(user=self.person, activity=self.c)
        Registration.objects.create(user=self.other, activity=self.c)
        schedule = self.request("bootstrap", client=self.participant)["schedule"]
        self.assertEqual(schedule[0]["taken"], 2)
        rows = self.request(f"events/{self.event.pk}/participants")
        self.assertEqual(len(rows), 2)

    def test_payload_owner_is_ignored(self):
        result = self.request("events", "post", self.event_body(owner_id=self.other.pk), status=201)
        self.assertEqual(Event.objects.get(pk=result["id"]).owner, self.owner)

    def test_invalid_payload(self):
        for value in [[], "broken", {"capacity": -1}]:
            with self.subTest(value=value):
                self.request(f"events/{self.event.pk}/activities", "post", value, status=400, code="VALIDATION")

    def test_setup_is_idempotent(self):
        call_command("migrate", verbosity=0, stdout=StringIO())
        self.assertTrue(ScheduleLock.objects.filter(pk=1).exists())


@override_settings(PASSWORD_HASHERS=FAST_HASHER)
class SessionTests(TestCase):
    def test_csrf_required_for_login_and_api(self):
        user = User.objects.create_user("session@example.test", "Unique-session-pass-2026!", name="Участник")
        client = Client(enforce_csrf_checks=True)
        self.assertEqual(client.post("/login/", {"username": user.email, "password": "Unique-session-pass-2026!"}).status_code, 403)
        client.get("/login/")
        token = client.cookies["csrftoken"].value
        result = client.post("/login/", {"username": user.email, "password": "Unique-session-pass-2026!", "csrfmiddlewaretoken": token})
        self.assertEqual(result.status_code, 302)
        self.assertEqual(client.get("/api/auth/me").json()["user"]["userId"], user.pk)
        self.assertEqual(client.patch("/api/profile", data='{}', content_type="application/json").status_code, 403)
        token = client.cookies["csrftoken"].value
        body = {"name": "Сохранено", "city": "Мурманск", "about": "", "interests": ""}
        self.assertEqual(client.patch("/api/profile", data=json.dumps(body), content_type="application/json", HTTP_X_CSRFTOKEN=token).status_code, 200)
        self.assertEqual(client.patch("/api/profile", data=json.dumps(body), content_type="application/json", HTTP_X_CSRFTOKEN=token, HTTP_ORIGIN="https://attacker.example").status_code, 403)
        self.assertEqual(client.get("/logout/").status_code, 405)
        self.assertEqual(client.post("/logout/", {"csrfmiddlewaretoken": token}).status_code, 302)
        self.assertIsNone(client.get("/api/auth/me").json()["user"])

    def test_registration_validates_and_authenticates(self):
        client = Client()
        password = "New-account-unique-2026!"
        response = client.post("/register/", {"email": "new@example.test", "name": "Новый участник", "password1": password, "password2": password, "next": "https://attacker.example"})
        self.assertRedirects(response, "/", fetch_redirect_response=False)
        self.assertEqual(client.get("/api/auth/me").json()["user"]["email"], "new@example.test")
        user = User.objects.get(email="new@example.test")
        self.assertNotEqual(user.password, password)
        self.assertTrue(user.check_password(password))

    @override_settings(DEBUG=False)
    def test_demo_login_not_available_in_production(self):
        self.assertEqual(Client().post("/demo-login/").status_code, 404)


@override_settings(PASSWORD_HASHERS=FAST_HASHER)
class ConcurrencyTests(Scenario, TransactionTestCase):
    reset_sequences = True

    def race(self, clients, activities):
        barrier = Barrier(len(clients))
        def attempt(pair):
            client, activity_id = pair
            close_old_connections()
            try:
                barrier.wait(timeout=15)
                result = client.post(f"/api/activities/{activity_id}/registration", data="{}", content_type="application/json")
                return result.status_code, result.json()
            finally:
                connections.close_all()
        with ThreadPoolExecutor(max_workers=len(clients)) as pool:
            return list(pool.map(attempt, zip(clients, activities)))

    def test_twenty_requests_for_last_seat(self):
        self.publish()
        clients = []
        for number in range(20):
            user = User.objects.create_user(f"race-{number}@example.test", None, name=f"Участник {number}")
            client = Client()
            client.force_login(user)
            clients.append(client)
        results = self.race(clients, [self.a.pk] * 20)
        self.assertEqual(sum(status == 200 for status, _ in results), 1, results)
        self.assertEqual(sum(status == 409 and body.get("code") == "NO_SEATS" for status, body in results), 19, results)
        self.assertEqual(Registration.objects.filter(activity=self.a).count(), 1)

    def test_simultaneous_conflicting_activities_same_user(self):
        self.publish()
        results = self.race([self.participant, self.participant], [self.a.pk, self.b.pk])
        self.assertEqual(sum(status == 200 for status, _ in results), 1, results)
        self.assertEqual(sum(status == 409 and body.get("code") == "PARTICIPANT_CONFLICT" for status, body in results), 1, results)
        self.assertEqual(Registration.objects.filter(user=self.person).count(), 1)
