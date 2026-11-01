from .webinar_clock import freeze_webinar_clock
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier
from unittest.mock import patch
import json
import jwt
from django.db import IntegrityError, close_old_connections, connections, transaction
from django.test import Client, TestCase, TransactionTestCase, override_settings
from django.utils import timezone
from flow.contracts import FlowError
from flow.models import Activity, EventRegistration, Registration, Webinar
from .test_api import FAST_HASHER, Scenario
from .test_webinar_transport import VIDEO


class ParallelScenario(Scenario):
    def setUp(self):
        super().setUp()
        self.webinar_clock = freeze_webinar_clock(self, self.start)
        self.event.format = "Гибрид"
        self.publish()
        self.event.save(update_fields=["format"])
        for room in [self.r1, self.r2]:
            room.is_online = True
            room.save(update_fields=["is_online"])
        self.d.starts_at, self.d.ends_at = self.a.starts_at, self.a.ends_at
        self.d.save(update_fields=["starts_at", "ends_at"])
        for person, activity in [(self.person, self.a), (self.other, self.d)]:
            EventRegistration.objects.create(event=self.event, user=person)
            Registration.objects.create(activity=activity, user=person)
        self.first = f"activities/{self.a.pk}/webinar"
        self.second = f"activities/{self.d.pk}/webinar"

    def start_both(self):
        return [self.request(path, "post", {"operation": "start"}) for path in [self.first, self.second]]


@override_settings(PASSWORD_HASHERS=FAST_HASHER, **VIDEO)
@patch("flow.webinars.room_api", return_value={})
class ParallelWebinarTests(ParallelScenario, TestCase):
    def test_overlapping_flows_have_isolated_sessions_tokens_and_capacity(self, media):
        hosts = self.start_both()
        self.assertNotEqual(hosts[0]["session"], hosts[1]["session"])
        self.assertEqual(Webinar.objects.filter(event=self.event, active=True).count(), 2)
        rooms = []
        for path, client, host in [(self.first, self.participant, hosts[0]), (self.second, self.stranger, hosts[1])]:
            viewer = self.request(path, "post", {"operation": "join"}, client=client)
            claims = jwt.decode(viewer["token"], VIDEO["LIVEKIT_API_SECRET"], algorithms=["HS256"], issuer=VIDEO["LIVEKIT_API_KEY"])
            host_claims = jwt.decode(host["token"], VIDEO["LIVEKIT_API_SECRET"], algorithms=["HS256"], issuer=VIDEO["LIVEKIT_API_KEY"])
            self.assertFalse(claims["video"]["canPublish"])
            self.assertTrue(host_claims["video"]["canPublish"])
            self.assertEqual(claims["video"]["room"], host_claims["video"]["room"])
            rooms.append(claims["video"]["room"])
        self.assertNotEqual(*rooms)
        self.assertEqual([call.kwargs["max_participants"] for call in media.call_args_list], [2, 3])

    def test_stopping_and_restarting_one_flow_does_not_change_other(self, media):
        first, second = self.start_both()
        self.request(self.first, "post", {"operation": "end"})
        self.assertFalse(self.request(self.first)["active"])
        self.assertTrue(self.request(self.second)["active"])
        self.assertEqual(self.request(self.second, "post", {"operation": "join"}, client=self.stranger)["session"], second["session"])
        restarted = self.request(self.first, "post", {"operation": "start"})
        self.assertNotEqual(restarted["session"], first["session"])
        self.assertEqual(self.request(self.second)["session"], second["session"])
        self.assertEqual([call.args[0] for call in media.call_args_list], ["CreateRoom", "CreateRoom", "DeleteRoom", "CreateRoom"])

    def test_general_event_webinar_remains_separate(self, media):
        first, second = self.start_both()
        path = f"events/{self.event.pk}/webinar"
        general = self.request(path, "post", {"operation": "start"})
        self.assertEqual(len({general["session"], first["session"], second["session"]}), 3)
        self.request(path, "post", {"operation": "end"})
        self.assertTrue(self.request(self.first)["active"])
        self.assertTrue(self.request(self.second)["active"])

    def test_event_ticket_does_not_grant_access_to_another_flow(self, media):
        self.start_both()
        for path, client in [(self.first, self.stranger), (self.second, self.participant)]:
            self.request(path, client=client, status=403, code="NOT_REGISTERED")
            self.request(path, "post", {"operation": "join", "host": True}, client=client, status=403, code="NOT_REGISTERED")

    def test_participant_cannot_start_or_stop_flow_and_foreign_organizer_is_denied(self, media):
        for operation in ["start", "end"]:
            self.request(self.first, "post", {"operation": operation}, client=self.participant, status=403, code="FORBIDDEN")
        self.other.role = "organizer"
        self.other.save(update_fields=["role"])
        self.request(self.second, client=self.stranger, status=403, code="FORBIDDEN")
        self.assertEqual(media.call_count, 0)

    def test_cancelling_activity_revokes_only_its_room(self, media):
        first, second = self.start_both()
        media.reset_mock()
        self.request(f"activities/{self.a.pk}/registration", "delete", client=self.participant)
        media.assert_called_once_with("RemoveParticipant", f"tflow-{first['session']}", identity=str(self.person.pk))
        self.request(self.first, "post", {"operation": "join"}, client=self.participant, status=403, code="NOT_REGISTERED")
        self.assertEqual(self.request(self.second)["session"], second["session"])
        self.assertTrue(EventRegistration.objects.filter(user=self.person, event=self.event).exists())

    def test_cancelling_event_revokes_all_of_users_sessions(self, media):
        hosts = self.start_both()
        self.request(f"events/{self.event.pk}/webinar", "post", {"operation": "start"})
        media.reset_mock()
        self.request(f"events/{self.event.pk}/registration", "delete", client=self.participant)
        self.assertEqual(media.call_count, 3)
        self.assertTrue(all(call.args[0] == "RemoveParticipant" for call in media.call_args_list))
        self.assertTrue(Webinar.objects.filter(activity=self.d, active=True).exists())

    def test_deleting_event_stops_every_room(self, media):
        self.start_both()
        self.request(f"events/{self.event.pk}/webinar", "post", {"operation": "start"})
        media.reset_mock()
        self.request(f"events/{self.event.pk}", "delete")
        self.assertEqual(media.call_count, 3)
        self.assertTrue(all(call.args[0] == "DeleteRoom" for call in media.call_args_list))
        self.assertFalse(Webinar.objects.exists())

    def test_media_failure_in_second_room_does_not_stop_first(self, media):
        first = self.request(self.first, "post", {"operation": "start"})
        media.side_effect = FlowError("VIDEO_UNAVAILABLE", "Недоступен", 503)
        self.request(self.second, "post", {"operation": "start"}, status=503)
        self.assertEqual(self.request(self.first)["session"], first["session"])
        self.assertTrue(self.request(self.first)["active"])
        self.assertFalse(Webinar.objects.filter(activity=self.d).exists())

    def test_expired_draft_physical_and_unknown_activities_are_rejected(self, media):
        self.request("activities/missing/webinar", status=404)
        self.request(self.first, client=Client(), status=401)
        self.r1.is_online = False
        self.r1.save(update_fields=["is_online"])
        self.request(self.first, status=400, code="NOT_WEBINAR")
        self.r1.is_online = True
        self.r1.save(update_fields=["is_online"])
        Activity.objects.filter(pk=self.a.pk).update(starts_at=timezone.now()-timedelta(hours=2),ends_at=timezone.now()-timedelta(hours=1))
        self.request(self.first, "post", {"operation": "start"}, status=409, code="WEBINAR_CLOSED")
        self.assertTrue(self.request(self.first)["ended"])
        self.event.status = "draft"
        self.event.save(update_fields=["status"])
        self.request(self.second, client=self.stranger, status=404)
        self.request(self.second, "post", {"operation": "start"}, status=409, code="WEBINAR_CLOSED")

    def test_online_room_conflicts_and_personal_conflicts_are_preserved(self, media):
        self.request(f"events/{self.event.pk}/activities", "post", self.activity_body(self.a, online_room=True), status=409, code="ROOM_CONFLICT")
        self.request(f"activities/{self.d.pk}/registration", "post", client=self.participant, status=409, code="PARTICIPANT_CONFLICT")

    def test_create_two_online_rooms_and_flows_at_the_same_time(self, media):
        for name in ["Python", "Django"]:
            self.request(f"events/{self.event.pk}/activities", "post", self.activity_body(self.a,
                title=name, room_id="", online_room=True, new_room_name=name, new_room_capacity=20), status=201)
        self.assertEqual(self.event.rooms.filter(is_online=True).count(), 4)
        self.request(f"events/{self.event.pk}/activities", "post", self.activity_body(self.a, room_id="", online_room=True), status=400, code="VALIDATION")

    def test_active_flow_cannot_be_moved_to_a_different_room(self, media):
        self.request(self.first, "post", {"operation": "start"})
        self.request(f"activities/{self.a.pk}", "patch", self.activity_body(self.a, room_id="", online_room=True, new_room_name="Новый поток"), status=409, code="WEBINAR_ACTIVE")
        self.assertFalse(self.event.rooms.filter(name="Новый поток").exists())

    def test_csrf_is_required_for_activity_webinar(self, media):
        client = Client(enforce_csrf_checks=True)
        client.force_login(self.owner)
        self.assertEqual(client.post(f"/api/{self.first}", data=json.dumps({"operation":"start"}),content_type="application/json").status_code, 403)

    def test_general_webinar_remains_unique(self, media):
        Webinar.objects.create(event=self.event)
        with self.assertRaises(IntegrityError), transaction.atomic():
            Webinar.objects.create(event=self.event)
        Webinar.objects.create(event=self.event, activity=self.a)
        Webinar.objects.create(event=self.event, activity=self.d)
        self.assertEqual(Webinar.objects.count(), 3)


@override_settings(PASSWORD_HASHERS=FAST_HASHER, **VIDEO)
class ConcurrentParallelWebinarTests(ParallelScenario, TransactionTestCase):
    def run_starts(self, paths):
        barrier = Barrier(len(paths))
        clients = [Client() for _ in paths]
        for client in clients:
            client.force_login(self.owner)
        def worker(index):
            close_old_connections()
            try:
                barrier.wait(timeout=10)
                response = clients[index].post(f"/api/{paths[index]}", data=json.dumps({"operation":"start"}),content_type="application/json")
                return response.status_code, response.json()
            finally:
                connections.close_all()
        with ThreadPoolExecutor(max_workers=len(paths)) as pool:
            return list(pool.map(worker, range(len(paths))))

    @patch("flow.webinars.room_api", return_value={})
    def test_parallel_starts_create_two_independent_streams(self, media):
        results = self.run_starts([self.first, self.second])
        self.assertEqual([result[0] for result in results], [200, 200])
        self.assertEqual(len({result[1]["session"] for result in results}), 2)
        self.assertEqual(media.call_count, 2)

    @patch("flow.webinars.room_api", return_value={})
    def test_duplicate_parallel_starts_do_not_create_duplicate_rooms(self, media):
        results = self.run_starts([self.first] * 4)
        self.assertEqual([result[0] for result in results], [200] * 4)
        self.assertEqual(len({result[1]["session"] for result in results}), 1)
        self.assertEqual(media.call_count, 1)
