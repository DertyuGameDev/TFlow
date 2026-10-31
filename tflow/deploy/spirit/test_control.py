import contextlib
import io
import unittest
from unittest.mock import Mock

from control import ApiError, ControlError, HOST, IMAGE_ID, Spirit, VM_ID, power_cycle, rebuild


class RecoverySafetyTests(unittest.TestCase):
    def api(self):
        api = Mock(spec=Spirit)
        api.vm.return_value = {"id": VM_ID, "fqdn": HOST, "status": "active", "ip": "158.160.209.13"}
        api.ensure_started.return_value = api.vm.return_value
        return api

    def cycle(self, api):
        with contextlib.redirect_stdout(io.StringIO()):
            power_cycle(api)

    def test_shutdown_timeout_still_restores_power(self):
        api = self.api()
        api.wait.side_effect = ControlError("Shutdown status timed out")
        with self.assertRaises(ControlError):
            self.cycle(api)
        api.ensure_started.assert_called_once()

    def test_lost_stop_response_still_attempts_recovery(self):
        api = self.api()
        api.request.side_effect = ControlError("Connection lost after sending stop")
        with self.assertRaises(ControlError):
            self.cycle(api)
        api.ensure_started.assert_called_once()

    def test_authorization_rejection_does_not_attempt_more_mutations(self):
        api = self.api()
        api.request.side_effect = ApiError(403)
        with self.assertRaises(ApiError):
            self.cycle(api)
        api.ensure_started.assert_not_called()

    def test_wrong_instance_is_rejected_before_any_management_action(self):
        api = Spirit("test-token")
        api.request = Mock(return_value={"attributes": {"id": "another-vm", "fqdn": HOST}})
        with self.assertRaises(ControlError):
            power_cycle(api)
        api.request.assert_called_once_with("GET")

    def test_rebuild_requires_separate_confirmation_before_any_api_access(self):
        api = self.api()
        with self.assertRaises(ControlError):
            rebuild(api, "")
        api.vm.assert_not_called()
        api.request.assert_not_called()

    def test_rebuild_never_discards_an_existing_previous_instance(self):
        api = self.api()
        api.vm.return_value.update(image={"attributes": {"id": IMAGE_ID}}, existPrevious=True)
        with self.assertRaises(ControlError):
            rebuild(api, VM_ID)
        api.request.assert_not_called()

    def test_lost_rebuild_response_is_not_retried(self):
        api = self.api()
        api.vm.return_value.update(image={"attributes": {"id": IMAGE_ID}}, existPrevious=False)
        api.request.side_effect = ControlError("Connection lost after rebuild was sent")
        with self.assertRaises(ControlError), contextlib.redirect_stdout(io.StringIO()):
            rebuild(api, VM_ID)
        self.assertEqual(api.request.call_count, 1)
        self.assertIs(api.request.call_args.kwargs["payload"]["attributes"]["withoutBackup"], False)

    def test_failed_provider_operation_is_not_reported_as_restored(self):
        api = self.api()
        api.vm.return_value.update(image={"attributes": {"id": IMAGE_ID}}, existPrevious=False)
        api.request.side_effect = [{"id": VM_ID}, {"done": True, "error": {"code": "FAILED"}}]
        with self.assertRaises(ControlError), contextlib.redirect_stdout(io.StringIO()):
            rebuild(api, VM_ID)
        api.wait.assert_not_called()


if __name__ == "__main__":
    unittest.main()
