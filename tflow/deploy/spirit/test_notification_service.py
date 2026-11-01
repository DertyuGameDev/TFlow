from pathlib import Path
import unittest
from notification_service import UNIT, enabled_environment

class NotificationWorkerDeployTests(unittest.TestCase):
    def test_persistent_keys_and_existing_database_settings_survive_redeploy(self):
        original='DATABASE_URL=private-test\nTFLOW_WEB_PUSH=0\nCUSTOM=keep\n'
        updated=enabled_environment(original)
        self.assertEqual(enabled_environment(updated),updated)
        self.assertIn('DATABASE_URL=private-test',updated);self.assertIn('CUSTOM=keep',updated)
        self.assertIn('TFLOW_WEB_PUSH=1',updated)
        self.assertIn('/var/lib/tflow/webpush/private.pem',updated)

    def test_bounded_worker_runs_as_app_user_without_docker(self):
        for value in ['User=tflow','Restart=always','CPUQuota=25%','MemoryMax=256M','NoNewPrivileges=true','ProtectSystem=strict','ReadWritePaths=/var/lib/tflow','manage.py run_notification_worker']:
            self.assertIn(value,UNIT)
        self.assertNotIn('docker',UNIT)

    def test_installer_checks_worker_readiness_and_preserves_live_guard_and_rollback(self):
        source=Path(__file__).with_name('install-release.py').read_text()
        self.assertLess(source.index('ensure_no_live_broadcast()'),source.index('release.mkdir'))
        self.assertIn('as_app(python, app / "manage.py", "setup_web_push"',source)
        self.assertIn('/api/notification-health',source)
        self.assertIn('env_path.write_text(env_before)',source)
        self.assertIn('stop", "tflow-notifications',source)
