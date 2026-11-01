from .webinar_clock import freeze_webinar_clock
from datetime import timedelta
import json
from pathlib import Path
import tempfile
import shutil
import subprocess
import time
import unittest
from unittest.mock import patch

from django.test import Client, TransactionTestCase, override_settings
from django.utils import timezone

from flow.broadcasts import stream_dir, MAX_CHUNK
from flow.models import HttpBroadcast, EventRegistration, CheckIn, BroadcastMessage
from .test_api import FAST_HASHER, Scenario


@override_settings(PASSWORD_HASHERS=FAST_HASHER, HTTP_BROADCAST_ENABLED=True)
class HttpBroadcastTests(Scenario, TransactionTestCase):
    def setUp(self):
        super().setUp()
        self.webinar_clock = freeze_webinar_clock(self, self.start + timedelta(minutes=31))
        self.private = tempfile.TemporaryDirectory()
        self.override = override_settings(HTTP_BROADCAST_ROOT=Path(self.private.name))
        self.override.enable()
        self.addCleanup(self.private.cleanup); self.addCleanup(self.override.disable)
        (Path(self.private.name) / "worker").touch()
        self.event.format = "Онлайн"; self.event.save(); self.publish()
        EventRegistration.objects.create(user=self.person, event=self.event)
        self.r1.is_online=True;self.r1.save()
        self.a.registration_required=False;self.a.save()
        self.endpoint = f"activities/{self.a.pk}/broadcast"

    def begin(self):
        return self.request(self.endpoint, "post", {"operation": "start", "mime": "video/webm"})

    def assert_h264_aac(self, segment):
        # Decode the actual segment, not only its container metadata.
        result = subprocess.run(["ffmpeg", "-hide_banner", "-i", str(segment), "-f", "null", "-"],
                                check=True, capture_output=True, text=True, timeout=15)
        self.assertIn("Video: h264", result.stderr)
        self.assertIn("Audio: aac", result.stderr)

    def upload(self, lease, seq=0, data=b"\x1aE\xdf\xa3test", client=None, publisher=None):
        return (client or self.client).post(f"/api/broadcasts/{lease['session']}/chunks/{seq}",
            data=data, content_type="application/octet-stream", HTTP_X_TFLOW_PUBLISHER=publisher if publisher is not None else lease["publisher"])

    def test_start_is_rejected_until_exact_scheduled_instant_without_side_effects(self):
        self.webinar_clock.now.return_value = self.start - timedelta(microseconds=1)
        state = self.request(self.endpoint)
        self.assertTrue(state["scheduled"])
        self.assertFalse(state["can_start"])
        self.assertEqual(state["starts_at"], self.start.isoformat())
        self.request(self.endpoint, "post", {"operation": "start", "mime": "video/webm"}, status=409, code="WEBINAR_TOO_EARLY")
        self.assertFalse(HttpBroadcast.objects.exists())
        self.assertFalse(any(Path(self.private.name).glob("*/")))
        self.webinar_clock.now.return_value = self.start
        self.assertTrue(self.request(self.endpoint)["can_start"])
        self.begin()

    def test_activity_uses_its_own_start_and_rechecks_changed_schedule(self):
        self.r2.is_online = True; self.r2.save()
        path = f"activities/{self.b.pk}/broadcast"
        self.webinar_clock.now.return_value = self.start
        self.request(path, "post", {"operation": "start", "mime": "video/webm"}, status=409, code="WEBINAR_TOO_EARLY")
        self.assertEqual(self.request(path)["starts_at"], self.b.starts_at.isoformat())
        self.webinar_clock.now.return_value = self.b.starts_at
        lease = self.request(path, "post", {"operation": "start", "mime": "video/webm"})
        self.request(path, "post", {"operation": "end", "session": lease["session"]})
        self.b.starts_at += timedelta(minutes=5); self.b.save(update_fields=["starts_at"])
        self.request(path, "post", {"operation": "start", "mime": "video/webm"}, status=409, code="WEBINAR_TOO_EARLY")

    def test_private_status_and_publisher_rights(self):
        self.request(self.endpoint, client=Client(), status=401)
        self.request(self.endpoint, client=self.stranger, status=403)
        state = self.request(self.endpoint, client=self.participant)
        self.assertEqual(state["transport"], "https")
        self.assertFalse(state["host"])
        self.request(self.endpoint, "post", {"operation": "start", "mime": "video/webm"}, client=self.participant, status=403)
        lease = self.begin()
        self.assertNotIn("publisher", self.request(self.endpoint, client=self.participant))
        self.assertNotEqual(HttpBroadcast.objects.get().publisher_hash, lease["publisher"])
        self.assertEqual(self.upload(lease, client=self.participant).status_code, 403)
        self.assertEqual(self.upload(lease, publisher="wrong").status_code, 403)

    def test_ordered_retry_does_not_duplicate_or_replace_media(self):
        lease = self.begin()
        self.assertEqual(self.upload(lease).json(), {"next": 1})
        self.assertEqual(self.upload(lease).json(), {"next": 1})
        self.assertEqual(len(list(stream_dir(lease["session"]).glob("*.bin"))), 1)
        self.assertEqual(self.upload(lease, data=b"changed").status_code, 409)
        self.assertEqual(self.upload(lease, seq=2).status_code, 409)
        self.assertEqual(self.upload(lease, seq=1, data=b"more").status_code, 200)

    def test_bounds_header_and_backpressure(self):
        lease = self.begin()
        self.assertEqual(self.upload(lease, data=b"bad header").status_code, 400)
        self.assertEqual(self.upload(lease, data=b"x" * (MAX_CHUNK + 1)).status_code, 413)
        self.assertEqual(self.upload(lease).status_code, 200)
        directory = stream_dir(lease["session"])
        for i in range(1, 12): (directory / f"input-{i:09d}.bin").write_bytes(b"queued")
        self.assertEqual(self.upload(lease, seq=1, data=b"more").status_code, 429)
        self.assertEqual(HttpBroadcast.objects.get().received_seq, 0)

    def test_no_attendance_until_actual_media_and_ticket_revocation_blocks_media(self):
        lease = self.begin()
        directory = stream_dir(lease["session"])
        (directory / "index.m3u8").write_text("#EXTM3U\nsegment-000000000.ts\n")
        (directory / "segment-000000000.ts").write_bytes(b"test-media")
        url = f"/api/broadcasts/{lease['session']}/media/"
        response = self.participant.get(url + "index.m3u8")
        self.assertEqual(response.status_code, 200); response.close()
        self.assertFalse(CheckIn.objects.exists())
        response = self.participant.get(url + "segment-000000000.ts")
        self.assertEqual(b"".join(response.streaming_content), b"test-media")
        self.assertIn("no-store", response["Cache-Control"])
        self.assertEqual(CheckIn.objects.get().source, "webinar")
        EventRegistration.objects.filter(user=self.person).delete()
        self.assertEqual(self.participant.get(url + "segment-000000000.ts").status_code, 403)
        self.assertEqual(self.client.get(url + "input-000000000.bin").status_code, 404)

    def test_end_invalidates_old_session_and_second_studio_cannot_take_over(self):
        lease = self.begin()
        self.request(self.endpoint, "post", {"operation": "start", "mime": "video/webm"}, status=409)
        self.request(self.endpoint, "post", {"operation": "end", "session": "wrong"}, status=409)
        self.request(self.endpoint, "post", {"operation": "end", "session": lease["session"]})
        self.assertEqual(self.upload(lease).status_code, 409)
        next_lease = self.begin()
        self.assertNotEqual(lease["session"], next_lease["session"])
        self.assertEqual(self.upload(lease).status_code, 404)

    def test_expiration_publication_and_worker_loss(self):
        lease = self.begin()
        HttpBroadcast.objects.update(last_chunk_at=timezone.now() - timedelta(seconds=31))
        self.assertTrue(self.request(self.endpoint)["active"])
        self.assertTrue(self.request(self.endpoint)["reconnecting"])
        self.assertEqual(self.upload(lease).status_code, 409)
        (Path(self.private.name) / "worker").unlink()
        self.request(self.endpoint, "post", {"operation": "start", "mime": "video/webm"}, status=503)
        self.event.ends_at = timezone.now() - timedelta(seconds=1)
        self.event.starts_at = self.event.ends_at - timedelta(hours=1); self.event.save()
        self.request(self.endpoint, "post", {"operation": "start", "mime": "video/webm"}, status=409)

    def test_chat_author_is_server_derived_and_scope_rechecked(self):
        lease = self.begin()
        path = f"broadcasts/{lease['session']}/chat"
        result = self.request(path, "post", {"text": "Вопрос", "author": "Подмена"}, client=self.participant)
        self.assertEqual(result["messages"][0]["author"], self.person.email.split("@", 1)[0])
        self.request(path, "post", {"text": "Ещё"}, client=self.participant, status=429)
        self.request(path, client=self.stranger, status=403)
        self.request(path, "post", {"text": "x" * 1001}, status=400)
        self.request(self.endpoint, "post", {"operation": "end", "session": lease["session"]})
        self.request(path, client=self.participant, status=409)

    def test_blank_profile_name_does_not_hide_chat_author_or_expose_domain(self):
        self.person.name = ""
        self.person.email = "anna.petrova@example.test"
        self.person.save(update_fields=["name", "email"])
        lease = self.begin()
        path = f"broadcasts/{lease['session']}/chat"
        result = self.request(path, "post", {"text": "Вопрос", "author": "Чужое имя"}, client=self.participant)
        self.assertEqual(result["messages"][0]["author"], "anna.petrova")
        self.assertNotIn("@", result["messages"][0]["author"])
        self.assertEqual(self.request(path)["messages"][0]["author"], "anna.petrova")

    def test_csrf_still_required_for_commands_and_binary_upload(self):
        client = Client(enforce_csrf_checks=True); client.force_login(self.owner)
        self.assertEqual(client.post("/api/" + self.endpoint, data=json.dumps({"operation": "start"}), content_type="application/json").status_code, 403)
        self.assertEqual(self.upload(self.begin(), client=client).status_code, 403)

    def test_feature_flag_and_old_webinar_stop(self):
        from flow.webinars import stop_webinar
        self.begin()
        with patch("flow.webinars.room_api"):
            stop_webinar(self.event, activity_id=self.a.pk)
        self.assertFalse(HttpBroadcast.objects.get().active)
        with override_settings(HTTP_BROADCAST_ENABLED=False):
            self.request(self.endpoint, status=404)

    def test_stream_and_chat_are_separate_for_parallel_activities(self):
        self.r1.is_online = True; self.r1.save(); self.r2.is_online = True; self.r2.save()
        one = self.request(f"activities/{self.a.pk}/broadcast", "post", {"operation": "start", "mime": "video/webm"})
        two = self.request(f"activities/{self.b.pk}/broadcast", "post", {"operation": "start", "mime": "video/webm"})
        self.assertNotEqual(one["session"], two["session"])
        self.request(f"broadcasts/{one['session']}/chat", "post", {"text": "Первый флоу"})
        self.assertEqual(self.request(f"broadcasts/{two['session']}/chat")["messages"], [])
        from flow.models import Activity
        third=Activity.objects.create(event=self.event,room=self.r1,title="Третий поток",starts_at=self.a.starts_at,ends_at=self.a.ends_at,capacity=1)
        self.request(f"activities/{third.pk}/broadcast", "post", {"operation": "start", "mime": "video/webm"}, status=503)

    @unittest.skipUnless(shutil.which("ffmpeg"), "Real encoding requires FFmpeg")
    def test_real_webm_chunks_become_h264_aac_hls(self):
        from flow.broadcast_worker import Encoder
        source = Path(self.private.name) / "synthetic.webm"
        subprocess.run(["ffmpeg", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=15",
                        "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "8",
                        "-c:v", "libvpx", "-deadline", "realtime", "-threads", "1", "-c:a", "libopus", str(source)],
                       check=True, capture_output=True, timeout=15)
        lease = self.begin(); broadcast = HttpBroadcast.objects.get()
        payload = source.read_bytes()
        for seq, offset in enumerate(range(0, len(payload), 32768)):
            response = self.upload(lease, seq=seq, data=payload[offset:offset+32768])
            self.assertEqual(response.status_code, 200)
        broadcast.refresh_from_db()
        encoder = Encoder(broadcast)
        try:
            deadline = time.monotonic() + 10
            while time.monotonic() < deadline:
                encoder.feed(broadcast)
                if (stream_dir(lease["session"]) / "index.m3u8").exists(): break
                time.sleep(0.02)
            playlist = (stream_dir(lease["session"]) / "index.m3u8").read_text()
            self.assertIn("#EXTM3U", playlist)
            segment = next(stream_dir(lease["session"]).glob("segment-*.ts"))
            self.assert_h264_aac(segment)
        finally:
            encoder.close()

    @unittest.skipUnless(shutil.which("ffmpeg"), "Real encoding requires FFmpeg")
    def test_resumed_generation_encodes_fresh_headers_without_changing_room(self):
        from flow.broadcast_worker import Encoder
        from flow.broadcasts import media_dir
        source=Path(self.private.name)/"resume.webm"
        subprocess.run(["ffmpeg","-loglevel","error","-f","lavfi","-i","testsrc2=size=160x90:rate=15","-f","lavfi","-i","sine=frequency=600:sample_rate=48000","-t","6","-c:v","libvpx","-deadline","realtime","-threads","1","-c:a","libopus",str(source)],check=True,capture_output=True,timeout=15)
        lease=self.begin()
        for generation in range(2):
            if generation:
                lease=self.request(self.endpoint,"post",{"operation":"resume","publisher":lease["publisher"],"mime":"video/webm"})
            broadcast=HttpBroadcast.objects.get();directory=media_dir(broadcast)
            for seq,offset in enumerate(range(0,len(source.read_bytes()),32768)):
                self.assertEqual(self.upload(lease,seq,source.read_bytes()[offset:offset+32768]).status_code,200)
            broadcast.refresh_from_db();encoder=Encoder(broadcast)
            try:
                deadline=time.monotonic()+10
                while time.monotonic()<deadline and not (directory/"index.m3u8").exists():encoder.feed(broadcast);time.sleep(.02)
                segment=next(directory.glob("segment-*.ts"))
                self.assert_h264_aac(segment)
                self.assertEqual(str(broadcast.session),lease["session"])
                self.assertEqual(broadcast.media_epoch,generation)
            finally:encoder.close()

    def test_resume_keeps_logical_session_and_chat_but_rotates_media_and_publisher(self):
        lease=self.begin();self.upload(lease)
        self.request(f"broadcasts/{lease['session']}/chat","post",{"text":"Не терять чат"})
        next_lease=self.request(self.endpoint,"post",{"operation":"resume","mime":"video/webm","publisher":lease['publisher']})
        self.assertEqual(next_lease['session'],lease['session'])
        self.assertNotEqual(next_lease['publisher'],lease['publisher'])
        self.assertEqual(HttpBroadcast.objects.get().media_epoch,1)
        self.assertEqual(self.upload(lease,seq=1,data=b'old').status_code,403)
        self.assertEqual(self.upload(next_lease).status_code,200)
        self.assertEqual(self.request(f"broadcasts/{lease['session']}/chat")['messages'][0]['text'],'Не терять чат')
        self.assertEqual(self.participant.get(f"/api/broadcasts/{lease['session']}/media/0/index.m3u8").status_code,409)

    def test_only_original_publisher_can_resume_and_schedule_is_authoritative(self):
        lease=self.begin()
        self.request(self.endpoint,'post',{'operation':'resume','mime':'video/webm','publisher':'wrong'},status=403)
        self.request(self.endpoint,'post',{'operation':'resume','mime':'video/webm','publisher':lease['publisher']},client=self.participant,status=403)
        self.a.starts_at=self.start+timedelta(minutes=45);self.a.save()
        self.assertTrue(self.request(self.endpoint)['scheduled'])
        self.request(self.endpoint,'post',{'operation':'resume','mime':'video/webm','publisher':lease['publisher']},status=409,code='WEBINAR_TOO_EARLY')
        self.assertEqual(self.upload(lease).status_code,409)

    def test_new_broadcast_must_belong_to_an_activity(self):
        self.request(f'events/{self.event.pk}/broadcast','post',{'operation':'start','mime':'video/webm'},status=400,code='WEBINAR_ACTIVITY_REQUIRED')
        self.assertFalse(HttpBroadcast.objects.exists())
