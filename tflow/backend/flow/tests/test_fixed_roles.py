from django.db import DataError, IntegrityError, transaction
from django.test import Client, TestCase, override_settings

from flow.models import EventRegistration, Registration, User, WaitlistEntry
from flow.services import promote_waitlist_locked, schedule_write
from .test_api import FAST_HASHER, Scenario


@override_settings(PASSWORD_HASHERS=FAST_HASHER)
class FixedRoleTests(Scenario, TestCase):
    def test_old_upgrade_endpoint_cannot_change_either_role(self):
        for client, user in [(self.participant, self.person), (self.client, self.owner)]:
            before = User.objects.values().get(pk=user.pk)
            self.request("profile/become-organizer", "post", {
                "role": "organizer", "user_id": self.other.pk,
                "is_staff": True, "is_superuser": True,
            }, client=client, status=403, code="ROLE_FIXED")
            self.assertEqual(User.objects.values().get(pk=user.pk), before)
        self.request("profile/become-organizer", "post", client=Client(), status=401)

    def test_profile_payload_and_signup_query_cannot_change_existing_role(self):
        for client, user, other_role in [
            (self.participant, self.person, "organizer"),
            (self.client, self.owner, "participant"),
        ]:
            role = user.role
            self.request("profile", "patch", {"role": other_role, "is_staff": True}, client=client)
            response = client.get(f"/register/?role={other_role}")
            self.assertEqual(response.status_code, 302)
            response = client.post("/register/", {
                "role": other_role, "first_name": "Новый", "last_name": "Аккаунт",
                "email": "unexpected@example.test", "password1": "Local-test-password-42!",
                "password2": "Local-test-password-42!",
            })
            self.assertEqual(response.status_code, 302)
            user.refresh_from_db()
            self.assertEqual(user.role, role)
            self.assertFalse(user.is_staff or user.is_superuser)
            self.assertEqual(self.request("auth/me", client=client)["user"]["userId"], user.pk)
        self.assertEqual(User.objects.count(), 3)

    def test_participant_cannot_access_management_even_for_owned_event(self):
        for path in [
            f"events/{self.event.pk}/attendance", f"events/{self.event.pk}/participants",
            f"events/{self.event.pk}/attendee?qr={self.person.pass_token}",
        ]:
            self.request(path, client=self.participant, status=403, code="FORBIDDEN")
        for path, method, body in [
            ("events", "post", self.event_body()),
            (f"events/{self.event.pk}", "patch", self.event_body()),
            (f"events/{self.event.pk}", "delete", {}),
            (f"events/{self.event.pk}/publish", "post", {}),
            (f"events/{self.event.pk}/rooms", "post", {"name": "Зал", "capacity": 2}),
            (f"events/{self.event.pk}/activities", "post", self.activity_body(self.a)),
            (f"events/{self.event.pk}/check-in", "post", {"qr": str(self.person.pass_token)}),
            (f"events/{self.event.pk}/requirements", "patch", {"required_profile_fields": []}),
        ]:
            self.request(path, method, body, client=self.participant, status=403, code="FORBIDDEN")
        self.event.owner = self.person
        self.event.save(update_fields=["owner"])
        self.request(f"events/{self.event.pk}", client=self.participant, status=404)
        self.request(f"events/{self.event.pk}/publish", "post", client=self.participant, status=403)
        self.assertEqual(self.request("bootstrap", client=self.participant)["events"], [])
        self.assertEqual(self.participant.get("/admin/").status_code, 404)

    def test_organizer_cannot_register_for_own_or_foreign_event_or_queue(self):
        self.publish()
        for user in [self.owner, self.person]:
            if user == self.person:
                self.event.owner = self.person
                self.event.save(update_fields=["owner"])
            for path in [f"events/{self.event.pk}/registration", f"activities/{self.a.pk}/registration", f"activities/{self.a.pk}/waitlist"]:
                self.request(path, "post", client=self.client, status=403, code="FORBIDDEN")
        self.assertFalse(EventRegistration.objects.exists())
        self.assertFalse(Registration.objects.exists())
        self.assertFalse(WaitlistEntry.objects.exists())

    def test_legacy_organizer_tickets_are_not_used_as_participant_schedule(self):
        self.publish()
        EventRegistration.objects.create(user=self.owner, event=self.event)
        Registration.objects.create(user=self.owner, activity=self.a)
        WaitlistEntry.objects.create(user=self.owner, activity=self.b)
        state = self.request("bootstrap")
        for field in ["tickets", "schedule", "waitlist"]:
            self.assertEqual(state[field], [])
        self.assertEqual(state["profile"]["role"], "organizer")
        # Historical records are retained; no destructive data migration.
        self.assertTrue(EventRegistration.objects.filter(user=self.owner).exists())
        for path in ["profile/qr", "schedule/calendar"]:
            self.request(path, status=403, code="FORBIDDEN")
        self.request(f"events/{self.event.pk}/check-in", "post",
                     {"qr": str(self.owner.pass_token)}, status=409, code="NOT_REGISTERED")

    def test_waitlist_never_promotes_legacy_organizer_entry(self):
        self.publish()
        EventRegistration.objects.create(user=self.owner, event=self.event)
        WaitlistEntry.objects.create(user=self.owner, activity=self.a)
        with schedule_write():
            promote_waitlist_locked(self.a)
        self.assertFalse(Registration.objects.filter(user=self.owner).exists())

    def test_participant_can_register_and_organizer_can_publish_without_switching(self):
        self.request(f"events/{self.event.pk}/publish", "post")
        self.request(f"events/{self.event.pk}/registration", "post", client=self.participant)
        self.request(f"activities/{self.a.pk}/registration", "post", client=self.participant)
        self.assertTrue(Registration.objects.filter(user=self.person, activity=self.a).exists())
        self.request(f"events/{self.event.pk}/attendance")
        self.assertEqual(self.request("auth/me")["user"]["role"], "organizer")
        self.assertEqual(self.request("auth/me", client=self.participant)["user"]["role"], "participant")

    def test_database_rejects_third_role(self):
        for role in ["admin", "", "both"]:
            with self.subTest(role=role), self.assertRaises(IntegrityError), transaction.atomic():
                User.objects.filter(pk=self.person.pk).update(role=role)

    def test_database_rejects_combined_role(self):
        # PostgreSQL rejects the oversized varchar before evaluating CHECK;
        # SQLite applies CHECK directly. Both must reject the invalid role.
        with self.assertRaises((DataError, IntegrityError)), transaction.atomic():
            User.objects.filter(pk=self.person.pk).update(role="participant,organizer")
        self.person.refresh_from_db()
        self.assertEqual(self.person.role, "participant")
