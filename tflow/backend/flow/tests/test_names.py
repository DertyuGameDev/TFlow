from django.test import Client, TestCase, override_settings
from flow.models import User
from .test_api import FAST_HASHER, Scenario


@override_settings(PASSWORD_HASHERS=FAST_HASHER)
class NameTests(Scenario, TestCase):
    def test_profile_can_clear_all_optional_data_and_preserve_account_email(self):
        email = self.person.email
        fields = ["first_name", "last_name", "city", "phone", "birth_date", "telegram",
                  "organization", "job_title", "education", "website", "about", "interests"]
        self.request("profile", "patch", dict.fromkeys(fields, ""), client=self.participant)
        self.person.refresh_from_db()
        self.assertEqual(self.person.email, email)
        self.assertEqual(self.person.name, "")
        for field in fields:
            self.assertEqual(getattr(self.person, field), None if field == "birth_date" else "")
        identity = self.request("auth/me", client=self.participant)["user"]
        self.assertEqual(identity["displayName"], email)
        self.assertIsNone(identity["fullName"])

    def test_profile_accepts_surname_without_first_name(self):
        self.request("profile", "patch", {"first_name": "", "last_name": "Соколова"}, client=self.participant)
        self.person.refresh_from_db()
        self.assertEqual((self.person.first_name, self.person.last_name, self.person.name), ("", "Соколова", "Соколова"))

    def test_profile_without_name_can_save_other_optional_fields(self):
        self.person.name = ""
        self.person.first_name = ""
        self.person.last_name = ""
        self.person.save(update_fields=["name", "first_name", "last_name"])
        self.request("profile", "patch", {"education": "Университет"}, client=self.participant)
        self.person.refresh_from_db()
        self.assertEqual(self.person.education, "Университет")
        self.assertEqual(self.person.name, "")

    def signup(self, **changes):
        client = Client()
        response = client.post("/register/", {
            "role": "participant", "first_name": " Анна Мария ", "last_name": " де Ла Крус ",
            "email": "separate-names@example.test", "password1": "Unique-names-pass-42!", "password2": "Unique-names-pass-42!",
            **changes,
        })
        return client, response

    def test_signup_persists_both_parts_and_full_display_name(self):
        client, response = self.signup()
        self.assertEqual(response.status_code, 302, response.content)
        user = User.objects.get(email="separate-names@example.test")
        self.assertEqual((user.first_name, user.last_name, user.name), ("Анна Мария", "де Ла Крус", "Анна Мария де Ла Крус"))
        state = client.get("/api/bootstrap").json()["profile"]
        self.assertEqual(state["first_name"], "Анна Мария")
        self.assertEqual(state["last_name"], "де Ла Крус")
        self.assertEqual(client.get("/api/auth/me").json()["user"]["displayName"], user.name)

    def test_name_parts_can_be_completed_after_signup(self):
        for field in ["first_name", "last_name"]:
            with self.subTest(field=field):
                email = f"optional-{field}@example.test"
                _, response = self.signup(**{field: " ", "email": email})
                self.assertEqual(response.status_code, 302)
                self.assertEqual(getattr(User.objects.get(email=email), field), "")

    def test_profile_parts_update_full_name_and_are_isolated_to_current_user(self):
        body = {"first_name": " Софья ", "last_name": " Петрова-Соколова ", "city": "Мурманск", "about": "", "interests": "Дизайн"}
        self.request("profile", "patch", body, client=self.participant)
        self.person.refresh_from_db()
        self.assertEqual(self.person.first_name, "Софья")
        self.assertEqual(self.person.last_name, "Петрова-Соколова")
        self.assertEqual(self.person.name, "Софья Петрова-Соколова")
        self.assertEqual(self.request("auth/me", client=self.participant)["user"]["fullName"], self.person.name)
        self.other.refresh_from_db()
        self.assertEqual(self.other.name, "Другой участник")
        self.assertEqual(self.request("bootstrap", client=self.participant)["profile"]["last_name"], "Петрова-Соколова")

    def test_legacy_names_prefill_but_preserve_original(self):
        self.person.name = "Софья Иванова Петровна"
        self.person.save(update_fields=["name"])
        state = self.request("bootstrap", client=self.participant)["profile"]
        self.assertEqual(state["first_name"], "Софья")
        self.assertEqual(state["last_name"], "Иванова Петровна")
        self.person.refresh_from_db()
        self.assertEqual(self.person.name, "Софья Иванова Петровна")
        self.assertEqual(self.person.first_name, "")

    def test_profile_and_signup_accept_optional_surname_and_long_names(self):
        body = {"first_name": "Софья", "last_name": "", "city": "Мурманск", "about": "", "interests": ""}
        self.request("profile", "patch", body, client=self.participant)
        self.person.refresh_from_db()
        self.assertEqual(self.person.name, "Софья")
        self.request("profile", "patch", {**body, "first_name": "А"*500, "last_name": "Б"*500}, client=self.participant)
        _, response = self.signup(first_name="А"*500, last_name="Б"*500)
        self.assertEqual(response.status_code, 302)
        self.person.refresh_from_db()
        self.assertEqual(self.person.name, "А"*500 + " " + "Б"*500)
        self.assertEqual(User.objects.get(email="separate-names@example.test").name, self.person.name)

    def test_legacy_profile_payload_keeps_name_parts_consistent(self):
        self.request("profile", "patch", {"name": "Софья Петрова", "city": "Мурманск", "about": "", "interests": ""}, client=self.participant)
        self.person.refresh_from_db()
        self.assertEqual((self.person.first_name, self.person.last_name, self.person.name), ("Софья", "Петрова", "Софья Петрова"))
