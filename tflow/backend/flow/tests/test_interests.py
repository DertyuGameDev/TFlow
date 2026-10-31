from django.test import Client, TestCase, override_settings
from flow.models import User
from flow.interests import INTEREST_CATEGORIES
from .test_api import FAST_HASHER, Scenario


@override_settings(PASSWORD_HASHERS=FAST_HASHER)
class InterestTests(Scenario, TestCase):
    def signup(self, **changes):
        return Client().post("/register/", {
            "role": "participant", "first_name": "Новый", "last_name": "Участник", "email": "categories@example.test",
            "password1": "Local-category-password-42!", "password2": "Local-category-password-42!",
            "interests": ["Дизайн", "Разработка"], **changes,
        })

    def test_signup_saves_multiple_categories(self):
        self.assertEqual(self.signup().status_code, 302)
        self.assertEqual(User.objects.get(email="categories@example.test").interests, "Дизайн, Разработка")

    def test_signup_interests_are_optional_and_unknown_choices_rejected(self):
        self.assertEqual(self.signup(interests=[]).status_code, 302)
        self.assertEqual(User.objects.get(email="categories@example.test").interests, "")
        response = self.signup(email="invalid@example.test", interests=["Вымышленная категория"])
        self.assertEqual(response.status_code, 200)
        self.assertFalse(User.objects.filter(email="invalid@example.test").exists())
        self.assertIn("interests", response.context["form"].errors)

    def test_failed_signup_keeps_selected_categories(self):
        response = self.signup(password2="Different-password-42!")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.context["form"]["interests"].value(), ["Дизайн", "Разработка"])
        self.assertContains(response, 'value="Дизайн"')
        self.assertIn("password2", response.context["form"].errors)

    def test_profile_can_change_and_clear_categories_without_affecting_other_user(self):
        body = {"name": self.person.name, "city": self.person.city, "about": "", "interests": "Дизайн, Карьера"}
        self.request("profile", "patch", body, client=self.participant)
        self.assertEqual(self.request("bootstrap", client=self.participant)["profile"]["interests"], "Дизайн, Карьера")
        self.assertEqual(self.request("bootstrap", client=self.stranger)["profile"]["interests"], "")
        self.request("profile", "patch", {**body, "interests": ""}, client=self.participant)
        self.person.refresh_from_db()
        self.assertEqual(self.person.interests, "")

    def test_categories_cover_nontechnical_events_and_render_in_groups(self):
        response = Client().get("/register/")
        for label in ["Культура и творчество", "Спорт и отдых", "Люди и город"]:
            self.assertContains(response, label)
        interests = ["Музыка", "Спорт и фитнес", "Семья и дети"]
        self.assertEqual(self.signup(interests=interests).status_code, 302)
        self.assertEqual(User.objects.get(email="categories@example.test").interests, ", ".join(interests))

    def test_all_interests_can_be_selected_and_saved(self):
        response = self.signup(interests=INTEREST_CATEGORIES)
        self.assertEqual(response.status_code, 302)
        self.assertEqual(User.objects.get(email="categories@example.test").interests, ", ".join(INTEREST_CATEGORIES))
