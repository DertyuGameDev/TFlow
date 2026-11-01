import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import Mock

from control import VM_ID
from defense_data import EXPECTED, apply_request, pending_request


class DefenseResetTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)
        self.state = self.folder / 'state'
        self.path = self.folder / 'request.json'
        self.request = {'request_id': 'defense-test-once', 'vm_id': VM_ID,
                        'operation': 'replace_all_with_jury_fixtures', 'backup': False}
        self.path.write_text(json.dumps(self.request))
        self.runner = Mock()
        self.app = Mock(return_value=Mock(stdout=json.dumps(EXPECTED)))

    def apply(self):
        apply_request(self.request, 'a' * 40, Path('/python'), Path('/app'),
                      self.app, self.runner, self.state)

    def test_request_is_applied_once_and_future_deployments_do_not_reset_data(self):
        self.assertEqual(pending_request(self.path, self.state), self.request)
        self.apply()
        self.assertIsNone(pending_request(self.path, self.state))
        self.app.assert_called_once()
        self.assertEqual(self.runner.call_count, 3)
        self.assertTrue(all(call.args[:2] == ('systemctl', 'stop') for call in self.runner.call_args_list))
        self.assertEqual((self.state / 'defense-test-once.json').stat().st_mode & 0o777, 0o600)

    def test_invalid_vm_or_missing_confirmation_is_rejected(self):
        for change in ({'vm_id': 'other'}, {'backup': True}, {'request_id': '../escape'}):
            with self.subTest(change=change):
                self.path.write_text(json.dumps({**self.request, **change}))
                with self.assertRaises(RuntimeError):
                    pending_request(self.path, self.state)
        self.app.assert_not_called()

    def test_failed_command_restarts_services_and_cannot_automatically_repeat_reset(self):
        self.app.side_effect = subprocess.CalledProcessError(1, ['prepare_defense'])
        with self.assertRaises(subprocess.CalledProcessError):
            self.apply()
        self.assertEqual(self.runner.call_count, 6)
        with self.assertRaisesRegex(RuntimeError, 'already started'):
            pending_request(self.path, self.state)

    def test_existing_incomplete_receipt_blocks_any_reset(self):
        self.state.mkdir()
        (self.state / 'defense-test-once.json').write_text(json.dumps({'status': 'started'}))
        with self.assertRaises(RuntimeError):
            pending_request(self.path, self.state)
        self.app.assert_not_called()
