import json
import unittest

from install_video import ADDRESS, HOST, DNS_HOOK, RENEW_HOOK, livekit_config, validate


class OwnedVideoConfigTests(unittest.TestCase):
    def setUp(self):
        self.values = {"domain":HOST,"ip":ADDRESS,"dns_token":"00000000-0000-4000-8000-000000000000",
                       "api_key":"test_only_key_abcdefghijklmnopqrstuvwxyz", "api_secret":"test_only_secret_abcdefghijklmnopqrstuvwxyz"}

    def test_other_hosts_and_config_injection_are_rejected(self):
        for changes in [{"domain":"unowned.example.test"},{"ip":"127.0.0.1"},
                        {"api_key":"key\nadmin: true"},{"api_secret":"short"},{"dns_token":"missing"}]:
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                validate({**self.values,**changes})

    def test_tcp_and_turn_use_allowed_ports_and_advertise_vm_public_ip(self):
        config=json.loads(livekit_config(validate(self.values)))
        self.assertEqual(config["rtc"]["node_ip"],ADDRESS)
        self.assertFalse(config["rtc"]["use_external_ip"])
        self.assertEqual(config["rtc"]["tcp_port"],8081)
        self.assertEqual(config["turn"]["tls_port"],8083)
        self.assertEqual(config["turn"]["domain"],HOST)
        self.assertNotIn("127.0.0.1",config["bind_addresses"])
        self.assertNotIn("dns_token",config)

    def test_hooks_parse_as_python_and_do_not_change_a_records_during_cleanup(self):
        compile(DNS_HOOK,"dns-hook","exec")
        compile(RENEW_HOOK,"renew-hook","exec")
        self.assertIn("'txt':txt",DNS_HOOK)
        self.assertNotIn("'ip':",DNS_HOOK)
        self.assertIn("'clear']='true'",DNS_HOOK)
