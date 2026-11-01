from types import SimpleNamespace
from django.test import SimpleTestCase
from flow.webinar_names import chat_author


class WebinarNamesTests(SimpleTestCase):
    def test_email_prefix_is_used_even_when_profile_has_a_name(self):
        self.assertEqual(chat_author(SimpleNamespace(email=" anna.petrova@example.test ", name="Анна Петрова")), "anna.petrova")

    def test_missing_identity_has_a_nonempty_fallback(self):
        self.assertEqual(chat_author(SimpleNamespace(email="", name=" Имя ")), "Имя")
        self.assertEqual(chat_author(SimpleNamespace(email="", name=" ")), "Участник")
