from django.test import TestCase, override_settings
from flow.models import CheckIn
from .test_api import FAST_HASHER, Scenario


@override_settings(PASSWORD_HASHERS=FAST_HASHER)
class ParticipantCheckInFeedbackTests(Scenario, TestCase):
    def test_scan_updates_only_admitted_participants_status_in_detail_and_bootstrap(self):
        self.publish()
        for client in [self.participant, self.stranger]:
            self.request(f"events/{self.event.pk}/registration", "post", client=client)
        self.assertEqual(self.request("bootstrap", client=self.participant)["tickets"][0]["checked_in"], 0)
        self.request(f"events/{self.event.pk}/check-in", "post", {"qr": str(self.person.pass_token)})
        self.request(
            f"events/{self.event.pk}/check-in", "post", {"qr": str(self.person.pass_token)},
            status=409, code="ALREADY_CHECKED_IN",
        )
        for client, admitted in [(self.participant, 1), (self.stranger, 0)]:
            state = self.request("bootstrap", client=client)
            detail = self.request(f"events/{self.event.pk}", client=client)
            self.assertEqual(state["tickets"][0]["checked_in"], admitted)
            self.assertEqual(detail["event"]["checked_in"], admitted)
            self.assertEqual(detail["event"]["checked_in_count"], 1)
        self.assertEqual(CheckIn.objects.filter(event=self.event).count(), 1)

    def test_rejected_scan_does_not_show_participant_as_admitted(self):
        self.publish()
        self.request(f"events/{self.event.pk}/check-in", "post", {"qr": str(self.person.pass_token)}, status=409, code="NOT_REGISTERED")
        state = self.request("bootstrap", client=self.participant)
        self.assertEqual(state["events"][0]["checked_in"], 0)
        self.assertFalse(CheckIn.objects.exists())
