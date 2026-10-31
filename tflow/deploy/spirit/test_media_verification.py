from contextlib import redirect_stdout
import io
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
from unittest.mock import patch
from provision_video import media_command
import unittest

import jwt
from control import ControlError
from verify_video_media import room_token
from video_checks import verify_media


class MediaVerificationTests(unittest.TestCase):
    def test_separate_viewer_and_host_grants_match_application_roles(self):
        values = {"api_key": "test_only_key_abcdefghijklmnopqrstuvwxyz", "api_secret": "test_only_secret_abcdefghijklmnopqrstuvwxyz"}
        for publish in (False, True):
            token = room_token(values, "qa-host" if publish else "qa-viewer", "technical-room", publish)
            claims = jwt.decode(token, values["api_secret"], algorithms=["HS256"])
            self.assertEqual(claims["video"]["canPublish"], publish)
            self.assertTrue(claims["video"]["canPublishData"])
            self.assertEqual(claims["video"]["room"], "technical-room")
            self.assertLessEqual(claims["exp"] - claims["nbf"], 185)

    def test_sdk_is_isolated_pinned_and_receives_only_private_config_path(self):
        calls = []
        report = {"ok": True, "audio_frames": 40, "video_frames": 4, "audio_peak": 9000, "chat_received": True}
        def runner(args, stage):
            calls.append(args)
            return SimpleNamespace(stdout="ignored private-value\n" + json.dumps(report))
        output = io.StringIO()
        with tempfile.TemporaryDirectory() as directory, redirect_stdout(output):
            config = Path(directory) / "video.json"
            config.write_text("private-value")
            verify_media(Path(directory), config, runner)
        self.assertIn("livekit==1.2.0", calls[1])
        self.assertEqual(calls[-1][-1], str(config))
        self.assertNotIn("private-value", str(calls))
        self.assertNotIn("private-value", output.getvalue())

    def test_connected_clients_without_received_video_do_not_pass(self):
        report = {"ok": True, "audio_frames": 40, "video_frames": 0, "audio_peak": 9000, "chat_received": True}
        def runner(args, stage):
            return SimpleNamespace(stdout=json.dumps(report))
        with tempfile.TemporaryDirectory() as directory, self.assertRaises(ControlError):
            verify_media(Path(directory), Path(directory) / "video.json", runner)

    @patch("provision_video.subprocess.run")
    def test_failed_media_probe_only_reports_known_phase_names(self, run):
        run.return_value = SimpleNamespace(returncode=1,stdout=json.dumps({"ok":False,"phase":"private-value"}),stderr="private-value")
        with self.assertRaises(ControlError) as error:
            media_command(["python","verify_video_media.py"],"audio/video/chat transmission")
        self.assertNotIn("private-value",str(error.exception))
