from django.test import Client, TestCase, override_settings

from flow.models import Bookmark, Event, EventRegistration, Registration, User
from .test_api import FAST_HASHER, Scenario


@override_settings(PASSWORD_HASHERS=FAST_HASHER)
class OrganizerOnboardingTests(Scenario, TestCase):
    path = "profile/become-organizer"

    def test_participant_can_enable_creation_then_publish_event(self):
        self.request("events", "post", self.event_body(), client=self.participant,
                     status=403, code="FORBIDDEN")
        identity = self.request(self.path, "post", client=self.participant)["user"]
        self.assertEqual(identity["userId"], self.person.pk)
        self.assertEqual(identity["role"], "organizer")
        self.assertEqual(self.request("auth/me", client=self.participant)["user"], identity)
        self.assertEqual(self.request("bootstrap", client=self.participant)["profile"]["role"], "organizer")
        created = self.request("events", "post", self.event_body(title="Моя первая встреча"),
                               client=self.participant, status=201)
        event = Event.objects.get(pk=created["id"])
        self.assertEqual(event.owner_id, self.person.pk)
        self.assertEqual(event.status, "draft")
        self.request(f"events/{event.pk}", client=Client(), status=404)
        self.request(f"events/{event.pk}/publish", "post", client=self.participant)
        public = self.request(f"events/{event.pk}", client=Client())
        self.assertEqual(public["event"]["title"], "Моя первая встреча")
        self.assertEqual(public["event"]["status"], "published")
        # Enabling organization never grants access to someone else's event.
        self.request(f"events/{self.event.pk}/publish", "post", client=self.participant,
                     status=403, code="FORBIDDEN")

    def test_transition_preserves_account_session_tickets_and_qr(self):
        self.publish()
        self.request(f"activities/{self.a.pk}/registration", "post", client=self.participant)
        Bookmark.objects.create(user=self.person, event=self.event)
        before = User.objects.values().get(pk=self.person.pk)
        session_key = self.participant.session.session_key
        qr = self.participant.get("/api/profile/qr").content
        self.request(self.path, "post", client=self.participant)
        after = User.objects.values().get(pk=self.person.pk)
        self.assertEqual(after, {**before, "role": "organizer"})
        self.assertEqual(self.participant.session.session_key, session_key)
        self.assertEqual(self.participant.get("/api/profile/qr").content, qr)
        state = self.request("bootstrap", client=self.participant)
        self.assertEqual(state["tickets"][0]["id"], self.event.pk)
        self.assertEqual(state["schedule"][0]["id"], self.a.pk)
        self.assertEqual(state["events"][0]["saved"], 1)
        self.assertTrue(EventRegistration.objects.filter(user=self.person, event=self.event).exists())
        self.assertTrue(Registration.objects.filter(user=self.person, activity=self.a).exists())

    def test_repeated_transition_is_idempotent(self):
        first = self.request(self.path, "post", client=self.participant)
        second = self.request(self.path, "post", client=self.participant)
        self.assertEqual(first, second)
        self.assertEqual(User.objects.count(), 3)
        self.assertEqual(Event.objects.count(), 1)

    def test_target_and_privileged_flags_in_payload_are_ignored(self):
        self.request(self.path, "post", {"user_id": self.other.pk, "role": "admin",
                     "is_staff": True, "is_superuser": True, "pass_token": str(self.owner.pass_token)},
                     client=self.participant)
        self.person.refresh_from_db()
        self.other.refresh_from_db()
        self.assertEqual(self.person.role, "organizer")
        self.assertEqual(self.other.role, "participant")
        self.assertFalse(self.person.is_staff)
        self.assertFalse(self.person.is_superuser)
        self.assertNotEqual(self.person.pass_token, self.owner.pass_token)

    def test_organizer_cannot_be_demoted_through_this_endpoint(self):
        self.request(self.path, "post", {"role": "participant"})
        self.owner.refresh_from_db()
        self.assertEqual(self.owner.role, "organizer")

    def test_anonymous_request_cannot_enable_organization(self):
        self.request(self.path, "post", client=Client(), status=401, code="UNAUTHORIZED")
        self.person.refresh_from_db()
        self.assertEqual(self.person.role, "participant")

    def test_get_patch_and_delete_cannot_change_role(self):
        for method in ["get", "patch", "delete"]:
            with self.subTest(method=method):
                self.request(self.path, method, client=self.participant, status=404)
                self.person.refresh_from_db()
                self.assertEqual(self.person.role, "participant")

    def test_transition_requires_valid_csrf_and_same_origin(self):
        client = Client(enforce_csrf_checks=True)
        client.force_login(self.person)
        response = client.post("/api/" + self.path, data="{}", content_type="application/json")
        self.assertEqual(response.status_code, 403)
        self.person.refresh_from_db()
        self.assertEqual(self.person.role, "participant")
        client.get("/api/auth/me")
        token = client.cookies["csrftoken"].value
        response = client.post("/api/" + self.path, data="{}", content_type="application/json",
                               HTTP_X_CSRFTOKEN=token, HTTP_ORIGIN="https://attacker.example")
        self.assertEqual(response.status_code, 403)
        self.person.refresh_from_db()
        self.assertEqual(self.person.role, "participant")
        response = client.post("/api/" + self.path, data="{}", content_type="application/json",
                               HTTP_X_CSRFTOKEN=token)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["user"]["role"], "organizer")
