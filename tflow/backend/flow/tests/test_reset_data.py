from io import StringIO
from django.apps import apps
from django.core.management import call_command, CommandError
from django.test import Client, TransactionTestCase, override_settings
from flow.models import Event, ScheduleLock, User
from .test_api import FAST_HASHER, Scenario


@override_settings(PASSWORD_HASHERS=FAST_HASHER)
class ResetDataTests(Scenario, TransactionTestCase):
    def test_reset_requires_explicit_confirmation(self):
        with self.assertRaises(CommandError):
            call_command("reset_data", stdout=StringIO())
        self.assertTrue(Event.objects.filter(pk=self.event.pk).exists())

    def test_reset_removes_business_data_and_keeps_app_usable(self):
        call_command("reset_data", yes=True, stdout=StringIO())
        for model in apps.get_app_config("flow").get_models():
            if model != ScheduleLock:
                self.assertEqual(model.objects.count(), 0, model.__name__)
        self.assertEqual(ScheduleLock.objects.count(), 1)
        client = Client()
        self.assertEqual(
            client.get("/api/health").json(), {"ok": True, "backend": "django"}
        )
        self.assertEqual(client.get("/api/bootstrap").json()["events"], [])
        self.assertEqual(client.get("/api/auth/me").json()["user"], None)
        self.assertEqual(User.objects.count(), 0)
