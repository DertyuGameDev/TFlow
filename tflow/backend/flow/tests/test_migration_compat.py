import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


class WebinarMigrationCompatibilityTests(unittest.TestCase):
    def test_both_published_histories_and_a_fresh_database(self):
        script = Path(__file__).with_name('migration_scenarios.py')
        for scenario in ('fresh', 'main', 'gosha'):
            with self.subTest(history=scenario), tempfile.TemporaryDirectory() as folder:
                result = subprocess.run([sys.executable,str(script),scenario,str(Path(folder)/'db.sqlite3')],
                    env={**os.environ,'DJANGO_SETTINGS_MODULE':'config.settings'}, text=True,
                    capture_output=True, timeout=90)
                self.assertEqual(result.returncode,0,result.stdout+'\n'+result.stderr)
                self.assertTrue(json.loads(result.stdout.splitlines()[-1])['data_preserved'])
