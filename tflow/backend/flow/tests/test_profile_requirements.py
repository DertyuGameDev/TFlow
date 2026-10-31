from datetime import date
from django.test import Client, TestCase, override_settings
from flow.models import EventRegistration, Registration, WaitlistEntry
from flow.profile_data import PROFILE_LABELS
from .test_api import FAST_HASHER, Scenario


@override_settings(PASSWORD_HASHERS=FAST_HASHER)
class ProfileRequirementsTests(Scenario, TestCase):
    def setUp(self):
        super().setUp()
        self.publish()
        self.path = f"events/{self.event.pk}/registration"
        self.requirements = f"events/{self.event.pk}/requirements"

    def require(self, fields):
        self.request(self.requirements, "patch", {"required_profile_fields": fields})

    def test_owner_can_choose_and_clear_required_fields(self):
        self.require(["phone", "organization", "birth_date"])
        self.event.refresh_from_db()
        self.assertEqual(set(self.event.required_profile_fields), {"phone", "organization", "birth_date"})
        self.assertEqual(self.request(f"events/{self.event.pk}")["event"]["required_profile_fields"], self.event.required_profile_fields)
        self.require([])
        self.event.refresh_from_db()
        self.assertEqual(self.event.required_profile_fields, [])

    def test_requirements_are_owner_only(self):
        for client, status in [(Client(), 401), (self.participant, 403)]:
            self.request(self.requirements, "patch", {"required_profile_fields": ["phone"]}, client=client, status=status)
        self.other.role = "organizer"
        self.other.save(update_fields=["role"])
        self.request(self.requirements, "patch", {"required_profile_fields": ["phone"]}, client=self.stranger, status=403)

    def test_requirements_reject_unknown_duplicate_and_untyped_fields(self):
        for value in [["pass_token"], ["role"], ["email"], ["phone", "phone"], [True], [["phone"]], "phone", None]:
            with self.subTest(value=value):
                self.request(self.requirements, "patch", {"required_profile_fields": value}, status=400, code="VALIDATION")
        self.event.refresh_from_db()
        self.assertEqual(self.event.required_profile_fields, [])

    def test_missing_fields_do_not_issue_ticket_or_partially_save_profile(self):
        self.require(["phone", "organization", "city"])
        self.person.phone = "+7 999 111-22-33"
        self.person.save(update_fields=["phone"])
        result = self.request(self.path, "post", {"organization": "Компания"}, client=self.participant, status=409, code="PROFILE_INCOMPLETE")
        self.assertEqual(result["missing_fields"], ["city"])
        self.assertEqual(set(result["fields"]), {"city"})
        self.person.refresh_from_db()
        self.assertEqual(self.person.organization, "")
        self.assertFalse(EventRegistration.objects.filter(user=self.person).exists())

    def test_complete_profile_enrolls_without_form_and_shares_all_profile_data(self):
        self.require(["phone"])
        self.person.phone = "+7 999 111-22-33"
        self.person.education = "Университет"
        self.person.birth_date = date(2000, 2, 29)
        self.person.save()
        self.request(self.path, "post", {}, client=self.participant)
        snapshot = EventRegistration.objects.get(user=self.person, event=self.event).profile_data
        self.assertEqual(set(snapshot), set(PROFILE_LABELS))
        self.assertEqual(snapshot["education"], "Университет")
        self.assertEqual(snapshot["birth_date"], "2000-02-29")
        self.assertNotIn("pass_token", snapshot)
        self.assertNotIn("password", snapshot)

    def test_missing_data_saved_in_profile_and_ticket_together(self):
        self.require(["phone", "organization"])
        self.request(self.path, "post", {"phone": "+7 999 111-22-33", "organization": "Компания"}, client=self.participant)
        self.person.refresh_from_db()
        self.assertEqual(self.person.organization, "Компания")
        snapshot = EventRegistration.objects.get(user=self.person).profile_data
        self.assertEqual(snapshot["phone"], self.person.phone)
        state = self.request("bootstrap", client=self.participant)
        self.assertEqual(state["profile"]["organization"], "Компания")
        self.assertEqual(state["tickets"][0]["id"], self.event.pk)

    def test_next_event_reuses_previously_saved_answers(self):
        self.require(["phone"])
        self.request(self.path, "post", {"phone": "+7 999 111-22-33"}, client=self.participant)
        self.event.pk = None
        self.event.save()
        self.request(f"events/{self.event.pk}/registration", "post", {}, client=self.participant)
        self.assertEqual(EventRegistration.objects.filter(user=self.person).count(), 2)

    def test_repeat_does_not_modify_snapshot_or_invalidate_existing_ticket(self):
        self.request(self.path, "post", {}, client=self.participant)
        original = EventRegistration.objects.get(user=self.person).profile_data
        self.require(["phone"])
        self.request(self.path, "post", {"phone": "+7 999 111-22-33"}, client=self.participant)
        self.assertEqual(EventRegistration.objects.get(user=self.person).profile_data, original)
        self.assertEqual(EventRegistration.objects.filter(user=self.person).count(), 1)

    def test_profile_update_does_not_rewrite_data_already_shared(self):
        self.request(self.path, "post", {"organization": "При записи"}, client=self.participant)
        self.request("profile", "patch", {"organization": "Новое место"}, client=self.participant)
        rows = self.request(f"events/{self.event.pk}/attendance")
        self.assertEqual(rows[0]["profile_data"]["organization"], "При записи")
        self.person.refresh_from_db()
        self.assertEqual(self.person.organization, "Новое место")

    def test_full_event_does_not_save_submitted_profile(self):
        self.event.capacity = 1
        self.event.save(update_fields=["capacity"])
        self.request(self.path, "post", {}, client=self.stranger)
        self.request(self.path, "post", {"organization": "Не сохранять"}, client=self.participant, status=409, code="NO_SEATS")
        self.person.refresh_from_db()
        self.assertEqual(self.person.organization, "")

    def test_invalid_profile_fields_are_rejected_without_ticket(self):
        for values, field in [({"phone":"abcd"},"phone"), ({"phone":12345},"phone"), ({"birth_date":"2099-01-01"},"birth_date"), ({"birth_date":"2001-02-29"},"birth_date"), ({"birth_date":1234},"birth_date"), ({"website":"javascript:alert(1)"},"website"), ({"telegram":"https://t.me/user"},"telegram"), ({"education":"x"*241},"education")]:
            with self.subTest(values=values):
                result = self.request(self.path, "post", values, client=self.participant, status=400, code="VALIDATION")
                self.assertIn(field, result["fields"])
        self.assertFalse(EventRegistration.objects.filter(user=self.person).exists())

    def test_activity_registration_checks_same_fields_and_saves_profile(self):
        self.require(["phone"])
        path = f"activities/{self.a.pk}/registration"
        self.request(path, "post", {}, client=self.participant, status=409, code="PROFILE_INCOMPLETE")
        self.assertFalse(Registration.objects.filter(user=self.person).exists())
        self.request(path, "post", {"phone":"+7 999 111-22-33"}, client=self.participant)
        self.assertTrue(Registration.objects.filter(user=self.person, activity=self.a).exists())
        self.assertEqual(EventRegistration.objects.get(user=self.person).profile_data["phone"], "+7 999 111-22-33")

    def test_waitlist_cannot_bypass_required_profile_fields(self):
        self.request(f"activities/{self.a.pk}/registration", "post", {}, client=self.stranger)
        self.require(["phone"])
        path = f"activities/{self.a.pk}/waitlist"
        self.request(path, "post", {}, client=self.participant, status=409, code="PROFILE_INCOMPLETE")
        self.assertFalse(WaitlistEntry.objects.filter(user=self.person).exists())
        self.assertFalse(EventRegistration.objects.filter(user=self.person).exists())
        self.request(path, "post", {"phone":"+7 999 111-22-33"}, client=self.participant)
        self.assertTrue(WaitlistEntry.objects.filter(user=self.person).exists())
        self.assertEqual(EventRegistration.objects.get(user=self.person).profile_data["phone"], "+7 999 111-22-33")

    def test_profile_patch_preserves_unspecified_fields_and_protected_identity(self):
        self.person.phone = "+7 999 111-22-33"
        self.person.save(update_fields=["phone"])
        token = self.person.pass_token
        self.request("profile", "patch", {"education":"Университет", "role":"organizer", "email":"fake@example.test", "pass_token":"fake"}, client=self.participant)
        self.person.refresh_from_db()
        self.assertEqual(self.person.phone, "+7 999 111-22-33")
        self.assertEqual(self.person.education, "Университет")
        self.assertEqual(self.person.role, "participant")
        self.assertEqual(self.person.email, "person@example.test")
        self.assertEqual(self.person.pass_token, token)

    def test_organizer_receives_snapshot_in_attendance_and_qr(self):
        self.request(self.path, "post", {"phone":"+7 999 111-22-33", "education":"Университет"}, client=self.participant)
        rows = self.request(f"events/{self.event.pk}/attendance")
        self.assertEqual(rows[0]["profile_data"]["education"], "Университет")
        result = self.request(f"events/{self.event.pk}/check-in", "post", {"qr":str(self.person.pass_token)})
        self.assertEqual(result["attendee"]["profile_data"], rows[0]["profile_data"])

    def test_profile_data_is_not_public_or_visible_to_other_users(self):
        self.request(self.path, "post", {"phone":"+7 999 111-22-33"}, client=self.participant)
        for client in [Client(), self.stranger]:
            state = self.request("bootstrap", client=client)
            self.assertNotIn("+7 999", str(state))
            detail = self.request(f"events/{self.event.pk}", client=client)
            self.assertNotIn("profile_data", str(detail))
            self.request(f"events/{self.event.pk}/attendance", client=client, status=401 if not client.session.get("_auth_user_id") else 403)

    def test_legacy_registration_profile_is_still_readable(self):
        EventRegistration.objects.create(user=self.person, event=self.event)
        rows = self.request(f"events/{self.event.pk}/attendance")
        self.assertEqual(rows[0]["profile_data"]["name"], self.person.name)

