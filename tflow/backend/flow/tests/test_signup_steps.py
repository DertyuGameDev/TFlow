from django.test import Client, TestCase, override_settings

from flow.models import User
from .test_api import FAST_HASHER


@override_settings(PASSWORD_HASHERS=FAST_HASHER)
class CompactSignupTests(TestCase):
    password = "Minimal-signup-strong-947!"

    def test_catalog_signup_renders_both_role_choices(self):
        response = self.client.get("/register/?next=%2F%23events")
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.context["participant_signup"])
        self.assertContains(response, 'type="radio" name="role" value="participant"', count=1)
        self.assertContains(response, 'type="radio" name="role" value="organizer"', count=1)
        self.assertContains(response, "Как вы хотите использовать ТФлоу?")
        self.assertContains(response, "Роль нельзя изменить после регистрации.")
        self.assertContains(response, 'name="next" value="/#events"')

    def test_credential_check_does_not_create_or_authenticate_an_account(self):
        response = self.client.post("/register/", {
            "intent": "credentials", "email": " CHECK@example.test ",
            "password1": self.password, "role": "invalid", "interests": "invalid",
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"valid": True, "errors": {}})
        self.assertFalse(User.objects.exists())
        self.assertIsNone(self.client.get("/api/auth/me").json()["user"])
        self.assertNotContains(response, self.password)
        self.assertIn("no-store", response["Cache-Control"])

    def test_credential_check_reports_duplicate_email_and_weak_password(self):
        User.objects.create_user("taken@example.test", self.password)
        response = self.client.post("/register/", {
            "intent": "credentials", "email": "TAKEN@example.test", "password1": "123",
        })
        self.assertEqual(response.status_code, 400)
        self.assertFalse(response.json()["valid"])
        self.assertEqual(set(response.json()["errors"]), {"email", "password1"})
        self.assertEqual(User.objects.count(), 1)

    def test_minimal_signup_saves_tags_role_and_password_then_logs_in(self):
        for role in ["participant", "organizer"]:
            with self.subTest(role=role):
                client = Client()
                email = f"minimal-{role}@example.test"
                response = client.post("/register/", {
                    "email": email, "password1": self.password, "role": role,
                    "interests": ["Дизайн", "Музыка"], "next": "/#calendar",
                    "is_staff": "1", "is_superuser": "1",
                })
                self.assertRedirects(response, "/#calendar", fetch_redirect_response=False)
                user = User.objects.get(email=email)
                self.assertTrue(user.check_password(self.password))
                self.assertEqual(user.name, "")
                self.assertEqual(user.first_name, "")
                self.assertEqual(user.last_name, "")
                self.assertEqual(user.role, role)
                self.assertEqual(user.interests, "Дизайн, Музыка")
                self.assertFalse(user.is_staff)
                self.assertFalse(user.is_superuser)
                identity = client.get("/api/auth/me").json()["user"]
                self.assertEqual(identity["userId"], user.pk)
                self.assertEqual(identity["displayName"], email)

    def test_signup_can_skip_tags_and_defaults_to_participant(self):
        response = self.client.post("/register/", {
            "email": "skip@example.test", "password1": self.password,
        })
        self.assertEqual(response.status_code, 302)
        user = User.objects.get(email="skip@example.test")
        self.assertEqual((user.interests, user.role), ("", "participant"))

    def test_compact_event_signup_preserves_tags_and_forces_participant(self):
        data = {
            "email": "compact-event@example.test",
            "password1": self.password,
            "next": "/#event/an-event",
            "role": "organizer",
            "interests": ["Дизайн"],
        }
        response = self.client.post("/register/", {**data, "intent": "credentials"})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["valid"])
        self.assertFalse(User.objects.exists())
        response = self.client.post("/register/", data)
        self.assertRedirects(response, data["next"], fetch_redirect_response=False)
        user = User.objects.get(email=data["email"])
        self.assertEqual((user.role, user.name, user.interests), ("participant", "", "Дизайн"))

    def test_single_password_still_enforces_the_server_password_policy(self):
        response = self.client.post("/register/", {
            "email": "weak@example.test", "password1": "123",
        })
        self.assertEqual(response.status_code, 200)
        self.assertIn("password1", response.context["form"].errors)
        self.assertFalse(User.objects.exists())

    def test_invalid_preferences_do_not_create_an_account_or_reflect_password(self):
        response = self.client.post("/register/", {
            "email": "invalid@example.test", "password1": self.password,
            "role": "admin", "interests": ["unknown"],
        })
        self.assertEqual(response.status_code, 200)
        self.assertFalse(User.objects.exists())
        self.assertIn("role", response.context["form"].errors)
        self.assertIn("interests", response.context["form"].errors)
        self.assertNotContains(response, self.password)

    def test_credential_check_requires_csrf(self):
        response = Client(enforce_csrf_checks=True).post("/register/", {
            "intent": "credentials", "email": "csrf@example.test", "password1": self.password,
        })
        self.assertEqual(response.status_code, 403)
        self.assertFalse(User.objects.exists())
