from .webinar_clock import freeze_webinar_clock
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from unittest.mock import patch
import json
import jwt

from django.db import close_old_connections, connections
from django.test import Client, TestCase, TransactionTestCase, override_settings

from flow.contracts import FlowError
from flow.models import CheckIn, EventAccessKey, EventAccessUse, EventRegistration, Webinar
from .test_api import FAST_HASHER, Scenario
from .test_webinar_transport import VIDEO


class AccessScenario(Scenario):
    def setUp(self):
        super().setUp()
        self.webinar_clock = freeze_webinar_clock(self, self.start)
        self.d.starts_at, self.d.ends_at = self.a.starts_at, self.a.ends_at
        self.d.save(update_fields=["starts_at", "ends_at"])
        self.publish()
        self.event.format = "Гибрид"
        self.event.save(update_fields=["format"])
        for room in [self.r1, self.r2]:
            room.is_online = True
            room.save(update_fields=["is_online"])
        self.key_path = f"events/{self.event.pk}/access-keys"

    def issue(self, purpose="scan", activity=None):
        return self.request(self.key_path, "post", {"operation":"issue", "purpose":purpose,"activity_id":activity.pk if activity else None},status=201)["key"]

    def revoke(self, purpose="scan", activity=None):
        return self.request(self.key_path,"post",{"operation":"revoke","purpose":purpose,"activity_id":activity.pk if activity else None})


@override_settings(PASSWORD_HASHERS=FAST_HASHER, **VIDEO)
class AccessKeyApiTests(AccessScenario, TestCase):
    def test_only_owner_can_manage_keys_and_read_metadata(self):
        key = self.issue()
        meta = self.request(self.key_path)
        self.assertEqual(meta["scan_key"]["purpose"], "scan")
        self.assertNotIn(key,str(meta))
        self.assertNotIn("token_hash",str(meta))
        for client in [self.participant,self.stranger]:
            self.request(self.key_path,client=client,status=403,code="FORBIDDEN")
            for operation in ["issue","revoke"]:
                self.request(self.key_path,"post",{"operation":operation,"key":key},client=client,status=403,code="FORBIDDEN")

    def test_scope_rules_reject_scanner_for_activity_and_webinar_for_event_or_physical_room(self):
        self.request(self.key_path,"post",{"operation":"issue","purpose":"scan","activity_id":self.a.pk},status=400)
        self.request(self.key_path,"post",{"operation":"issue","purpose":"webinar"},status=400)
        self.r1.is_online=False;self.r1.save(update_fields=["is_online"])
        self.request(self.key_path,"post",{"operation":"issue","purpose":"webinar","activity_id":self.a.pk},status=400)
        self.request(self.key_path,"post",{"operation":"issue","purpose":"admin"},status=400)
        self.assertFalse(EventAccessKey.objects.exists())

    def test_scanner_key_admits_to_its_event_without_exposing_profile_contacts(self):
        key=self.issue()
        EventRegistration.objects.create(event=self.event,user=self.other)
        scope=self.request("access-keys/resolve","post",{"key":key},client=self.participant)
        self.assertEqual(scope["purpose"],"scan")
        self.assertEqual(scope["event"]["id"],self.event.pk)
        self.assertNotIn(key,str(scope))
        result=self.request("access-keys/check-in","post",{"key":key,"qr":str(self.other.pass_token),"event_id":"forged"},client=self.participant)
        self.assertTrue(result["admitted"])
        self.assertEqual(set(result["attendee"]),{"id","name","activities"})
        self.assertNotIn(self.other.email,str(result))
        entry=CheckIn.objects.get(event=self.event,user=self.other)
        self.assertEqual(entry.checked_by_id,self.person.pk)
        self.assertEqual(entry.access_key.token_hash,EventAccessKey.objects.get().token_hash)
        self.assertEqual(EventAccessUse.objects.get().user_id,self.person.pk)
        self.person.refresh_from_db()
        self.assertEqual(self.person.role,"participant")
        self.request(f"events/{self.event.pk}/attendance",client=self.participant,status=403,code="FORBIDDEN")
        self.request(f"events/{self.event.pk}","delete",{"key":key},client=self.participant,status=403)

    def test_key_does_not_bypass_owner_guard_of_regular_scanner(self):
        key=self.issue()
        self.request(f"events/{self.event.pk}/check-in","post",{"key":key,"qr":str(self.other.pass_token)},client=self.participant,status=403)

    def test_repeat_scan_from_owner_or_delegate_is_denied_and_invalid_qr_leaks_no_data(self):
        key=self.issue();EventRegistration.objects.create(event=self.event,user=self.other)
        self.request("access-keys/check-in","post",{"key":key,"qr":str(self.person.pass_token)},client=self.participant,status=409,code="NOT_REGISTERED")
        self.request("access-keys/check-in","post",{"key":key,"qr":"invalid"},client=self.participant,status=400,code="INVALID_QR")
        self.request("access-keys/check-in","post",{"key":key,"qr":str(self.other.pass_token)},client=self.participant)
        self.request(f"events/{self.event.pk}/check-in","post",{"qr":str(self.other.pass_token)},status=409,code="ALREADY_CHECKED_IN")
        self.request("access-keys/check-in","post",{"key":key,"qr":str(self.other.pass_token)},client=self.participant,status=409,code="ALREADY_CHECKED_IN")
        self.assertEqual(CheckIn.objects.count(),1)

    def test_revoked_scan_key_cannot_resolve_or_admit(self):
        key=self.issue();self.revoke()
        for path in ["access-keys/resolve","access-keys/check-in"]:
            self.request(path,"post",{"key":key,"qr":str(self.other.pass_token)},client=self.participant,status=403)
        self.assertFalse(CheckIn.objects.exists())

    @patch("flow.webinars.room_api",return_value={})
    def test_delegated_participant_can_host_only_specified_online_flow(self,media):
        key=self.issue("webinar",self.a)
        scope=self.request("access-keys/resolve","post",{"key":key},client=self.stranger)
        self.assertEqual(scope["activity"]["id"],self.a.pk)
        started=self.request("access-keys/webinar","post",{"key":key,"operation":"start","activity_id":self.d.pk},client=self.stranger)
        claims=jwt.decode(started["token"],VIDEO["LIVEKIT_API_SECRET"],algorithms=["HS256"],issuer=VIDEO["LIVEKIT_API_KEY"])
        self.assertTrue(started["host"])
        self.assertTrue(claims["video"]["canPublish"])
        self.assertEqual(claims["sub"],self.other.pk)
        self.assertTrue(Webinar.objects.filter(activity=self.a,active=True).exists())
        self.assertFalse(Webinar.objects.filter(activity=self.d).exists())
        self.assertFalse(EventRegistration.objects.filter(user=self.other).exists())
        self.request(f"activities/{self.d.pk}/webinar","post",{"operation":"start","key":key},client=self.stranger,status=403)
        self.request(self.key_path,client=self.stranger,status=403)
        self.other.refresh_from_db();self.assertEqual(self.other.role,"participant")

    @patch("flow.webinars.room_api",return_value={})
    def test_scanner_and_webinar_keys_are_not_interchangeable(self,media):
        scan=self.issue();webinar=self.issue("webinar",self.a)
        self.request("access-keys/webinar","post",{"key":scan,"operation":"start"},client=self.stranger,status=403)
        self.request("access-keys/check-in","post",{"key":webinar,"qr":str(self.person.pass_token)},client=self.stranger,status=403)
        self.assertFalse(CheckIn.objects.exists());self.assertEqual(media.call_count,0)

    @patch("flow.webinars.room_api",return_value={})
    def test_revoke_disconnects_delegated_host_without_ending_another_flow(self,media):
        first=self.issue("webinar",self.a);second=self.issue("webinar",self.d)
        one=self.request("access-keys/webinar","post",{"key":first,"operation":"start"},client=self.participant)
        self.request("access-keys/webinar","post",{"key":second,"operation":"start"},client=self.stranger)
        media.reset_mock();self.revoke("webinar",self.a)
        media.assert_called_once_with("RemoveParticipant",f"tflow-{one['session']}",identity=str(self.person.pk))
        self.request("access-keys/webinar","post",{"key":first,"operation":"join"},client=self.participant,status=403)
        self.assertTrue(self.request("access-keys/webinar","post",{"key":second,"operation":"status"},client=self.stranger)["active"])
        self.assertTrue(self.request(f"activities/{self.a.pk}/webinar")["host"])

    @patch("flow.webinars.room_api",return_value={})
    def test_rotation_revokes_previous_host_and_media_failure_does_not_undo_revocation(self,media):
        key=self.issue("webinar",self.a)
        self.request("access-keys/webinar","post",{"key":key,"operation":"start"},client=self.stranger)
        media.side_effect=FlowError("VIDEO_UNAVAILABLE","Недоступно",503)
        replacement=self.issue("webinar",self.a)
        self.assertNotEqual(key,replacement)
        self.request("access-keys/webinar","post",{"key":key,"operation":"status"},client=self.stranger,status=403)
        self.assertTrue(self.request("access-keys/webinar","post",{"key":replacement,"operation":"status"},client=self.stranger)["host"])

    def test_login_and_csrf_are_required(self):
        key=self.issue()
        self.request("access-keys/resolve","post",{"key":key},client=Client(),status=401)
        client=Client(enforce_csrf_checks=True);client.force_login(self.person)
        for path in ["access-keys/resolve","access-keys/check-in","access-keys/webinar"]:
            response=client.post(f"/api/{path}",data=json.dumps({"key":key}),content_type="application/json")
            self.assertEqual(response.status_code,403)

    def test_deleting_event_removes_keys_uses_and_delegated_checkins(self):
        key=self.issue();self.issue("webinar",self.a)
        EventRegistration.objects.create(event=self.event,user=self.other)
        self.request("access-keys/check-in","post",{"key":key,"qr":str(self.other.pass_token)},client=self.participant)
        self.request(f"events/{self.event.pk}","delete")
        self.assertFalse(EventAccessKey.objects.exists())
        self.assertFalse(EventAccessUse.objects.exists())
        self.assertFalse(CheckIn.objects.exists())
        self.request("access-keys/resolve","post",{"key":key},client=self.participant,status=403)


@override_settings(PASSWORD_HASHERS=FAST_HASHER)
class ConcurrentDelegatedScannerTests(AccessScenario,TransactionTestCase):
    def test_owner_and_delegate_race_admits_exactly_once(self):
        key=self.issue();EventRegistration.objects.create(user=self.other,event=self.event)
        barrier=Barrier(2)
        def worker(delegated):
            close_old_connections()
            try:
                client=Client();client.force_login(self.person if delegated else self.owner)
                path="access-keys/check-in" if delegated else f"events/{self.event.pk}/check-in"
                barrier.wait(timeout=10)
                response=client.post(f"/api/{path}",data=json.dumps({"key":key,"qr":str(self.other.pass_token)}),content_type="application/json")
                return response.status_code
            finally:connections.close_all()
        with ThreadPoolExecutor(max_workers=2) as pool: statuses=list(pool.map(worker,[False,True]))
        self.assertEqual(sorted(statuses),[200,409]);self.assertEqual(CheckIn.objects.count(),1)
