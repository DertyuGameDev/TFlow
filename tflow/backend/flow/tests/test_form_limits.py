from django.test import Client, TestCase, override_settings
from flow.models import Activity, Community, Event, Room, User
from .test_api import FAST_HASHER, Scenario


@override_settings(PASSWORD_HASHERS=FAST_HASHER, DEMO_MODE=True, AUTH_PASSWORD_VALIDATORS=[])
class DemoRegistrationTests(TestCase):
    def signup(self, **changes):
        return self.client.post("/register/", {
            "first_name": "Я", "email": "demo@example.test",
            "password1": "1", "password2": "1", **changes,
        })

    def test_one_character_name_no_surname_and_simple_password_register_and_login(self):
        response = self.signup()
        self.assertEqual(response.status_code, 302)
        person = User.objects.get(email="demo@example.test")
        self.assertEqual((person.name, person.last_name, person.role), ("Я", "", "participant"))
        self.assertTrue(person.check_password("1"))
        self.assertNotEqual(person.password, "1")
        self.assertFalse(person.is_staff or person.is_superuser)
        self.client.post("/logout/")
        response = self.client.post("/login/", {"username": person.email, "password": "1"})
        self.assertEqual(response.status_code, 302)
        self.assertEqual(self.client.get("/api/auth/me").json()["user"]["userId"], person.pk)

    def test_simplified_registration_keeps_email_role_and_password_match_checks(self):
        for changes in [
            {"email": "invalid"}, {"role": "admin"}, {"password2": "other"},
            {"password1": "", "password2": ""}, {"first_name": " "},
        ]:
            with self.subTest(changes=changes):
                self.assertEqual(self.signup(**changes).status_code, 200)
                self.assertFalse(User.objects.exists())

    def test_organizer_registration_still_uses_explicit_fixed_role(self):
        self.assertEqual(self.signup(role="organizer").status_code, 302)
        self.assertEqual(User.objects.get().role, "organizer")

    def test_all_interests_fit_and_registration_has_no_text_length_attributes(self):
        from flow.interests import INTEREST_CATEGORIES
        response = self.signup(interests=list(INTEREST_CATEGORIES))
        self.assertEqual(response.status_code, 302)
        self.assertGreater(len(User.objects.get().interests), 300)
        page = Client().get("/register/")
        self.assertContains(page, "Для демонстрации подойдёт любой непустой пароль")
        for name in ["first_name", "last_name", "password1", "password2"]:
            field = str(page.context["form"][name])
            self.assertNotIn("maxlength=", field)
            self.assertNotIn("minlength=", field)
        self.assertContains(page, '<details class="registration-interests">')


@override_settings(PASSWORD_HASHERS=FAST_HASHER)
class FormLimitTests(Scenario, TestCase):
    def test_event_program_and_auto_room_accept_short_text_and_large_capacity(self):
        created = self.request("events", "post", self.event_body(
            title="А", description="О", city="М", venue="З", capacity=500_001,
        ), status=201)
        event = Event.objects.get(pk=created["id"])
        self.assertEqual(event.capacity, 500_001)
        item = self.request(f"events/{event.pk}/activities", "post", {
            **self.activity_body(self.a, title="А", speaker="Я", capacity=500_001),
            "room_id": "",
        }, status=201)
        activity = Activity.objects.get(pk=item["id"])
        self.assertEqual(activity.capacity, 500_001)
        self.assertEqual(activity.room.capacity, 500_001)
        self.request(f"rooms/{activity.room_id}", "patch", {"name": "З", "capacity": 600_001})
        self.assertEqual(Room.objects.get(pk=activity.room_id).name, "З")

    def test_long_event_club_and_profile_text_is_saved_without_truncation(self):
        title, description = "А" * 1000, ("Описание " * 1000).strip()
        result = self.request("events", "post", self.event_body(title=title, description=description), status=201)
        self.assertEqual(Event.objects.get(pk=result["id"]).description, description)
        club = self.request("communities", "post", {
            "name": title, "description": description, "topic": "Музыка",
        }, status=201)
        self.assertEqual(Community.objects.get(pk=club["id"]).name, title)
        self.request("profile", "patch", {
            "name": "Я", "city": "М", "phone": "1", "telegram": "@a",
            "organization": title, "education": description, "about": description,
        }, client=self.participant)
        self.person.refresh_from_db()
        self.assertEqual(self.person.education, description)
        self.assertEqual(self.person.name, "Я")

    def test_club_accepts_one_character_name_and_description(self):
        result = self.request("communities", "post", {
            "name": "К", "description": "О", "topic": "Музыка",
        }, status=201)
        self.assertEqual(Community.objects.get(pk=result["id"]).name, "К")
