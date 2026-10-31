import importlib.util
from pathlib import Path
from unittest import TestCase

class MonitoringInstallTests(TestCase):
    def test_plan_preserves_private_ports_and_schedules_restartable_services(self):
        path=Path(__file__).resolve().parents[3]/'monitoring/install.py'
        spec=importlib.util.spec_from_file_location('monitoring_install',path)
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        units=module.units(path.parent.parent)
        self.assertIn('Requires=docker.service',units['/etc/systemd/system/tflow-monitoring.service'])
        self.assertIn('Restart=always',units['/etc/systemd/system/tflow-monitoring.service'])
        self.assertIn('OnUnitActiveSec=1m',units['/etc/systemd/system/tflow-reminders.timer'])
        self.assertIn('127.0.0.1:8000',units['/etc/systemd/system/tflow.service.d/monitoring.conf'])
        self.assertNotIn('PROMETHEUS_MULTIPROC_DIR',units['/etc/systemd/system/tflow-reminders.service'])

    def test_release_includes_monitoring_but_never_its_local_credentials(self):
        import subprocess
        import sys
        import tarfile
        import tempfile
        import json
        import os
        root=Path(__file__).resolve().parents[3]
        with tempfile.TemporaryDirectory() as directory:
            project=Path(directory)/'tflow'
            for folder in ['scripts','backend','dist','public','monitoring/secrets']:
                (project/folder).mkdir(parents=True,exist_ok=True)
            (project/'scripts/package-release.py').write_text((root/'scripts/package-release.py').read_text())
            (project/'dist/assets').mkdir()
            (project/'dist/index.html').write_text('<script src="/assets/app.js"></script>')
            (project/'dist/assets/app.js').write_text('verified build')
            (project/'dist/version.json').write_text(json.dumps({'id':'a'*40}))
            (project/'monitoring/install.py').write_text('installer')
            (project/'monitoring/secrets/metrics-token').write_text('secret-never-in-release')
            (project/'monitoring/.env').write_text('password=private')
            subprocess.run([sys.executable,str(project/'scripts/package-release.py')],check=True,capture_output=True,env={**os.environ,'CI_COMMIT_SHA':'a'*40})
            with tarfile.open(Path(directory)/'release/tflow-release.tar.gz') as archive:
                names=archive.getnames()
                self.assertIn('tflow/monitoring/install.py',names)
                self.assertFalse(any('/secrets/' in name or '/.env' in name for name in names))
