import unittest
from monitoring_native import dashboard, grafana_config


class NativeMonitoringConfigTests(unittest.TestCase):
    def test_grafana_is_loopback_only_viewer_and_uses_gateway_subpath(self):
        config = grafana_config('test-only-secret')
        for value in ('http_addr = 127.0.0.1', 'http_port = 13001', 'serve_from_sub_path = true',
                      'auto_assign_org_role = Viewer', 'whitelist = 127.0.0.1',
                      '[auth.anonymous]\nenabled = false'):
            self.assertIn(value, config)

    def test_provisioned_dashboard_has_only_existing_live_metric_sources(self):
        value = dashboard()
        self.assertEqual(value['uid'], 'tflow-production')
        self.assertEqual(len(value['panels']), 6)
        for panel in value['panels']:
            self.assertEqual(panel['datasource']['uid'], 'tflow-prometheus')
            self.assertIn('expr', panel['targets'][0])
