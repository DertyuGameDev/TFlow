from html import unescape
import re
from urllib.parse import parse_qs, urlencode, urlsplit

from django.test import Client, TestCase, override_settings

from flow.models import User
from .test_api import FAST_HASHER, Scenario


@override_settings(PASSWORD_HASHERS=FAST_HASHER)
class EventSignupTests(Scenario, TestCase):
    def signup(self, **changes):
        return {
            "first_name": "Новый",
            "last_name": "Участник",
            "email": "event-signup@example.test",
            "password1": "Unique-participant-password-42!",
            "password2": "Unique-participant-password-42!",
            "next": f"/#event/{self.event.pk}",
            **changes,
        }

    def assert_participant_form(self, response):
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.context["form"]["role"].is_hidden)
        self.assertNotContains(response, 'role="switch"')
        self.assertNotContains(response, "Выберите роль")
        self.assertNotContains(response, "Организовывать")
        self.assertContains(response, "Создайте аккаунт участника")

    def test_event_and_webinar_signup_hide_role_even_with_organizer_query(self):
        for view in ["event", "webinar"]:
            with self.subTest(view=view):
                target = f"/#{view}/{self.event.pk}"
                response = Client().get(
                    "/register/", {"next": target, "role": "organizer"}
                )
                self.assert_participant_form(response)
                self.assertEqual(
                    response.context["form"]["role"].value(), "participant"
                )
                self.assertEqual(response.context["next"], target)

    def test_posted_role_cannot_change_event_signup_account_type(self):
        for index, role in enumerate(["organizer", "admin", "participant"]):
            with self.subTest(role=role):
                guest = Client()
                email = f"event-signup-{index}@example.test"
                response = guest.post(
                    "/register/?role=organizer", self.signup(email=email, role=role)
                )
                self.assertEqual(response.status_code, 302)
                self.assertEqual(response["Location"], f"/#event/{self.event.pk}")
                self.assertEqual(User.objects.get(email=email).role, "participant")
                self.assertEqual(
                    guest.get("/api/auth/me").json()["user"]["role"], "participant"
                )

    def test_validation_error_keeps_participant_mode_and_entered_name(self):
        response = Client().post(
            "/register/", self.signup(role="organizer", password2="wrong")
        )
        self.assert_participant_form(response)
        self.assertEqual(response.context["form"]["first_name"].value(), "Новый")
        self.assertEqual(response.context["form"].cleaned_data["role"], "participant")
        self.assertFalse(
            User.objects.filter(email="event-signup@example.test").exists()
        )

    def test_login_link_back_to_signup_preserves_event_context(self):
        guest = Client()
        target = f"/#event/{self.event.pk}"
        login = guest.get("/login/", {"next": target})
        href = unescape(
            re.search(r'href="(/register/\?[^\"]+)"', login.content.decode())[1]
        )
        self.assertEqual(parse_qs(urlsplit(href).query)["next"], [target])
        self.assert_participant_form(guest.get(href))

    def test_other_destinations_keep_normal_role_choice(self):
        for target in ["/", "/#events", "/#profile", "/#calendar", "/#organizer"]:
            with self.subTest(target=target):
                response = Client().get(
                    "/register/", {"next": target, "role": "organizer"}
                )
                self.assertFalse(response.context["form"]["role"].is_hidden)
                self.assertContains(response, 'role="switch"')
                self.assertEqual(response.context["form"]["role"].value(), "organizer")

    def test_signup_without_posted_role_returns_to_event_and_allows_enrollment(self):
        self.publish()
        guest = Client()
        target = f"/#event/{self.event.pk}"
        data = self.signup()
        data.pop("next")
        response = guest.post("/register/?" + urlencode({"next": target}), data)
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response["Location"], target)
        self.request(f"events/{self.event.pk}/registration", "post", client=guest)
        person = User.objects.get(email=data["email"])
        self.assertTrue(self.event.enrollments.filter(user=person).exists())
