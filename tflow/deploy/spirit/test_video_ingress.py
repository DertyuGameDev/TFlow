from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest

from control import ControlError
from inspect_video_ingress import SCRIPT, capture_duration, redact_network_output, ssh_options


class VideoIngressTests(unittest.TestCase):
    def test_network_output_keeps_policy_but_withholds_addresses_and_comments(self):
        text = '-P INPUT ACCEPT\n-A input -s 8.8.8.8/32 -j DROP --comment "private-note"\nroute via 10.130.0.1\n' + 'A' * 43 + '\n2001:4860:4860::8888'
        redacted = redact_network_output(text)
        self.assertIn('-P INPUT ACCEPT', redacted)
        self.assertIn('-j DROP', redacted)
        self.assertIn('10.130.0.1', redacted)
        self.assertNotIn('8.8.8.8', redacted)
        self.assertNotIn('private-note', redacted)
        self.assertNotIn('A' * 43, redacted)
        self.assertNotIn('2001:4860:4860::8888', redacted)
        compile(SCRIPT, 'vm-ingress-diagnostics', 'exec')

    def test_capture_is_disabled_by_default_and_bounded(self):
        self.assertEqual(capture_duration(None), 0)
        self.assertEqual(capture_duration('90'), 90)
        for value in ('-1','91','unexpected'):
            with self.subTest(value=value), self.assertRaises(ControlError):
                capture_duration(value)

    def test_ssh_identity_is_pinned_and_private_files_are_restricted(self):
        values = {'attributes': {'username':'ubuntu','host':'158.160.209.13','privateKey':'test-only-private-material'}}
        api = SimpleNamespace(vm=lambda:{'status':'active','ip':'158.160.209.13'},request=lambda *args:values)
        with tempfile.TemporaryDirectory() as directory:
            options = ssh_options(api, Path(directory))
            self.assertIn('StrictHostKeyChecking=yes', options)
            self.assertEqual((Path(directory)/'ssh-key').stat().st_mode & 0o777, 0o600)
            self.assertNotIn('test-only-private-material', ' '.join(options))
            values['attributes']['host'] = 'other.example.test'
            with self.assertRaises(ControlError):
                ssh_options(api, Path(directory))
