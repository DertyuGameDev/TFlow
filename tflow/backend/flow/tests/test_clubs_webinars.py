from datetime import timedelta
from unittest.mock import patch
import jwt
from django.test import Client, TestCase, override_settings
from django.utils import timezone
from flow.models import Community, Event, EventRegistration, Membership, Webinar
from flow.contracts import FlowError
from .test_api import FAST_HASHER, Scenario


@override_settings(PASSWORD_HASHERS=FAST_HASHER)
class ClubTests(Scenario, TestCase):
    def body(self, **changes):
        return {
            "name": "Клуб настольных игр",
            "description": "Играем, знакомимся и проводим встречи",
            "topic": "Настольные игры",
            **changes,
        }

    def test_member_can_create_club_and_is_automatically_joined(self):
        result = self.request(
            "communities",
            "post",
            self.body(owner_id=self.owner.pk),
            client=self.participant,
            status=201,
        )
        club = Community.objects.get(pk=result["id"])
        self.assertEqual(club.owner, self.person)
        self.assertTrue(
            Membership.objects.filter(community=club, user=self.person).exists()
        )
        self.request(
            f"communities/{club.pk}",
            "patch",
            self.body(name="Изменённый клуб"),
            client=self.stranger,
            status=403,
        )
        self.request(
            f"communities/{club.pk}",
            "patch",
            self.body(name="Изменённый клуб"),
            client=self.participant,
        )
        club.refresh_from_db()
        self.assertEqual(club.name, "Изменённый клуб")

    def test_linking_event_requires_membership_and_retains_existing_link_after_leaving(
        self,
    ):
        club = Community.objects.create(
            name="Клуб", description="Описание клуба", topic="Музыка", color="yellow"
        )
        self.request(
            "events", "post", self.event_body(community_id=club.pk), status=403
        )
        self.request(f"communities/{club.pk}/join", "post")
        created = self.request(
            "events", "post", self.event_body(community_id=club.pk), status=201
        )
        self.request(f"communities/{club.pk}/join", "delete")
        self.request(
            f"events/{created['id']}", "patch", self.event_body(community_id=club.pk)
        )
        self.assertEqual(Event.objects.get(pk=created["id"]).community_id, club.pk)

    def test_counts_are_distinct_and_private_drafts_are_not_exposed(self):
        club = Community.objects.create(
            name="Клуб", description="Описание клуба", topic="Музыка", color="yellow"
        )
        for person in [self.owner, self.person]:
            Membership.objects.create(community=club, user=person)
        self.event.community = club
        self.event.save()
        state = self.request("bootstrap", client=self.participant)
        self.assertEqual(state["communities"][0]["member_count"], 2)
        self.assertEqual(state["communities"][0]["event_count"], 0)
        self.assertEqual(state["events"], [])
        self.publish()
        state = self.request("bootstrap", client=self.participant)
        self.assertEqual(state["communities"][0]["member_count"], 2)
        self.assertEqual(state["communities"][0]["event_count"], 1)

    def test_club_creation_requires_authentication_valid_category_and_csrf(self):
        self.request("communities", "post", self.body(), client=Client(), status=401)
        self.request(
            "communities", "post", self.body(topic="Неизвестная категория"), status=400
        )
        csrf = Client(enforce_csrf_checks=True)
        csrf.force_login(self.person)
        self.assertEqual(
            csrf.post("/api/communities", data=self.body()).status_code, 403
        )


VIDEO_SECRET = "test-only-livekit-secret-at-least-32-bytes"


@override_settings(
    PASSWORD_HASHERS=FAST_HASHER,
    LIVEKIT_URL="wss://video.example.test",
    LIVEKIT_API_KEY="test-key",
    LIVEKIT_API_SECRET=VIDEO_SECRET,
)
class WebinarTests(Scenario, TestCase):
    def setUp(self):
        super().setUp()
        self.event.format = "Онлайн"
        self.event.status = "published"
        self.event.save()
        EventRegistration.objects.create(event=self.event, user=self.person)
        self.path = f"events/{self.event.pk}/webinar"

    def decode(self, result):
        return jwt.decode(
            result["token"], VIDEO_SECRET, algorithms=["HS256"], issuer="test-key"
        )

    @patch("flow.webinars.room_api", return_value={})
    def test_host_and_viewer_receive_different_signed_permissions(self, media):
        host = self.request(self.path, "post", {"operation": "start"})
        viewer = self.request(
            self.path,
            "post",
            {"operation": "join", "host": True},
            client=self.participant,
        )
        host_claims, viewer_claims = self.decode(host), self.decode(viewer)
        self.assertTrue(host_claims["video"]["canPublish"])
        self.assertFalse(viewer_claims["video"]["canPublish"])
        self.assertTrue(viewer_claims["video"]["canSubscribe"])
        self.assertEqual(host_claims["video"]["room"], viewer_claims["video"]["room"])
        self.assertEqual(viewer_claims["sub"], self.person.pk)
        self.assertLessEqual(viewer_claims["exp"] - viewer_claims["nbf"], 305)
        self.assertNotIn(VIDEO_SECRET, str(viewer))

    def test_unregistered_and_foreign_organizer_cannot_control_or_enter(self):
        self.request(self.path, client=Client(), status=401)
        self.request(self.path, client=self.stranger, status=403)
        for operation in ["start", "end"]:
            self.request(
                self.path,
                "post",
                {"operation": operation},
                client=self.participant,
                status=403,
            )
        self.other.role = "organizer"
        self.other.save()
        self.request(
            self.path, "post", {"operation": "start"}, client=self.stranger, status=403
        )

    def test_legacy_ticket_does_not_let_organizer_enter_as_viewer(self):
        self.other.role = "organizer"
        self.other.save(update_fields=["role"])
        EventRegistration.objects.create(user=self.other, event=self.event)
        self.request(self.path, client=self.stranger, status=403, code="FORBIDDEN")
        for operation in ["join", "start", "end"]:
            self.request(self.path, "post", {"operation": operation},
                         client=self.stranger, status=403, code="FORBIDDEN")

    def test_participant_does_not_get_host_rights_from_event_ownership(self):
        self.event.owner = self.person
        self.event.save(update_fields=["owner"])
        self.assertFalse(self.request(self.path, client=self.participant)["host"])
        self.request(self.path, "post", {"operation": "start", "host": True},
                     client=self.participant, status=403, code="FORBIDDEN")

    @patch("flow.webinars.room_api", return_value={})
    def test_start_is_idempotent_end_disconnects_and_restart_has_new_room(self, media):
        first = self.request(self.path, "post", {"operation": "start"})
        second = self.request(self.path, "post", {"operation": "start"})
        self.assertEqual(first["session"], second["session"])
        self.assertEqual(media.call_count, 1)
        self.request(self.path, "post", {"operation": "end"})
        self.assertEqual(media.call_args.args[0], "DeleteRoom")
        self.request(
            self.path,
            "post",
            {"operation": "join"},
            client=self.participant,
            status=409,
        )
        self.assertTrue(self.request(self.path)["finished"])
        third = self.request(self.path, "post", {"operation": "start"})
        self.assertNotEqual(first["session"], third["session"])

    @patch("flow.webinars.room_api", return_value={})
    def test_registration_cancellation_revokes_future_tokens_and_event_deletion_ends_room(
        self, media
    ):
        self.request(self.path, "post", {"operation": "start"})
        self.request(
            f"events/{self.event.pk}/registration", "delete", client=self.participant
        )
        self.assertEqual(media.call_args.args[0], "RemoveParticipant")
        self.request(
            self.path,
            "post",
            {"operation": "join"},
            client=self.participant,
            status=403,
        )
        self.request(f"events/{self.event.pk}", "delete")
        self.assertEqual(media.call_args.args[0], "DeleteRoom")
        self.assertFalse(Webinar.objects.filter(event_id=self.event.pk).exists())

    @patch(
        "flow.webinars.room_api",
        side_effect=FlowError("VIDEO_UNAVAILABLE", "Недоступен", 503),
    )
    def test_media_failure_does_not_create_a_false_active_session(self, media):
        self.request(self.path, "post", {"operation": "start"}, status=503)
        self.assertFalse(Webinar.objects.filter(event=self.event, active=True).exists())

    def test_closed_draft_physical_and_missing_configuration_cannot_start(self):
        for changes, status in [
            ({"status": "draft"}, 409),
            ({"status": "published", "format": "Очно"}, 400),
            (
                {
                    "format": "Онлайн",
                    "ends_at": timezone.now() - timedelta(seconds=1),
                    "starts_at": timezone.now() - timedelta(hours=1),
                },
                409,
            ),
        ]:
            Event.objects.filter(pk=self.event.pk).update(**changes)
            self.request(self.path, "post", {"operation": "start"}, status=status)
        with override_settings(LIVEKIT_API_SECRET=""):
            self.request(self.path, "post", {"operation": "start"}, status=503)
