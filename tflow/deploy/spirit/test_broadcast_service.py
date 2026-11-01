from types import SimpleNamespace
import unittest
from unittest.mock import patch
from broadcast_service import UNIT, enabled_environment, ensure_no_live_broadcast


class BroadcastServiceTests(unittest.TestCase):
    @patch("broadcast_service.subprocess.run")
    def test_live_webinar_blocks_release_without_any_service_command(self, run):
        run.side_effect = [SimpleNamespace(stdout="flow_httpbroadcast\n"), SimpleNamespace(stdout="1\n")]
        with self.assertRaisesRegex(RuntimeError, "live"):
            ensure_no_live_broadcast()
        self.assertTrue(all("psql" in args.args[0] for args in run.call_args_list))

    @patch("broadcast_service.subprocess.run")
    def test_first_install_and_idle_broadcasts_are_safe(self, run):
        run.return_value = SimpleNamespace(stdout="\n")
        ensure_no_live_broadcast(); self.assertEqual(run.call_count, 1)
        run.reset_mock(); run.side_effect = [SimpleNamespace(stdout="flow_httpbroadcast"), SimpleNamespace(stdout="0")]
        ensure_no_live_broadcast(); self.assertEqual(run.call_count, 2)

    def test_isolated_resources_and_unrelated_environment_are_preserved(self):
        text = "DATABASE_URL=test-only\nLIVEKIT_URL=wss://existing.test\nTFLOW_HTTP_BROADCAST=0\n"
        changed = enabled_environment(text)
        self.assertIn("DATABASE_URL=test-only", changed)
        self.assertIn("LIVEKIT_URL=wss://existing.test", changed)
        self.assertEqual(changed.count("TFLOW_HTTP_BROADCAST="), 1)
        for setting in ["MemoryMax=768M", "CPUQuota=150%", "User=tflow", "NoNewPrivileges=true", "ReadWritePaths=/var/lib/tflow"]:
            self.assertIn(setting, UNIT)
