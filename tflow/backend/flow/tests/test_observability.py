import json
import logging
from io import StringIO
from unittest.mock import patch

from django.db import OperationalError
from django.test import Client, SimpleTestCase, TestCase, override_settings
from prometheus_client.parser import text_string_to_metric_families

from flow.observability import JsonFormatter, request_id


class TelemetryLoggingTests(SimpleTestCase):
    def test_exception_stack_has_no_values_credentials_or_query(self):
        stream = StringIO()
        handler = logging.StreamHandler(stream)
        handler.setFormatter(JsonFormatter())
        logger = logging.Logger('flow.test')
        logger.addHandler(handler)
        context = request_id.set('correlation-test')
        try:
            try:
                raise ValueError('password=secret email=private@example.test')
            except ValueError:
                logger.exception('request_failed')
        finally:
            request_id.reset(context)
        record = json.loads(stream.getvalue())
        self.assertEqual(record['request_id'], 'correlation-test')
        self.assertEqual(record['exception_type'], 'ValueError')
        self.assertTrue(record['stack'])
        self.assertNotIn('secret', stream.getvalue())
        self.assertNotIn('private@example.test', stream.getvalue())
        self.assertIsNone(request_id.get())


@override_settings(MONITORING_TOKEN='test-metrics-token')
class TelemetryEndpointTests(TestCase):
    def scrape(self):
        return self.client.get('/internal/metrics', HTTP_AUTHORIZATION='Bearer test-metrics-token')

    def test_metrics_are_closed_by_default_and_require_separate_secret(self):
        for auth in ['', 'Bearer wrong', 'Bearer юникод']:
            self.assertEqual(self.client.get('/internal/metrics', HTTP_AUTHORIZATION=auth).status_code, 404)
        with override_settings(MONITORING_TOKEN=''):
            self.assertEqual(self.scrape().status_code, 404)
        response = self.scrape()
        self.assertEqual(response.status_code, 200)
        self.assertIn('no-store', response['Cache-Control'])
        self.assertEqual(self.client.post('/internal/metrics', HTTP_AUTHORIZATION='Bearer test-metrics-token').status_code, 405)

    def test_records_status_duration_and_correlation_without_identifiers(self):
        response = self.client.get('/api/events/private-event-id?key=secret-email@example.test', HTTP_X_REQUEST_ID='untrusted')
        self.assertRegex(response['X-Request-ID'], r'^[a-f0-9]{32}$')
        self.assertNotEqual(response['X-Request-ID'], 'untrusted')
        metrics = self.scrape().content.decode()
        samples = [sample for family in text_string_to_metric_families(metrics) for sample in family.samples]
        self.assertTrue(any(s.name == 'tflow_http_requests_total' and s.labels.get('route') == '/api/events' and s.labels.get('status') == str(response.status_code) for s in samples))
        self.assertTrue(any(s.name == 'tflow_http_duration_seconds_count' and s.labels.get('route') == '/api/events' for s in samples))
        for secret in ['private-event-id', 'secret-email', 'test-metrics-token']:
            self.assertNotIn(secret, metrics)
        self.assertIsNone(request_id.get())

    def test_database_outage_records_error_and_can_be_correlated(self):
        with patch('flow.models.ScheduleLock.objects.get', side_effect=OperationalError('secret SQL')):
            response = self.client.get('/api/health')
        self.assertEqual(response.status_code, 503)
        self.assertIn('X-Request-ID', response)
        self.assertIn('tflow_errors_total{logger="flow"}', self.scrape().content.decode())

    @override_settings(DEBUG=False)
    def test_unhandled_error_is_logged_and_measured(self):
        client = Client(raise_request_exception=False)
        with patch('flow.views.dispatch_api', side_effect=ValueError('secret')):
            response = client.get('/api/health')
        self.assertEqual(response.status_code, 500)
        self.assertNotContains(response, 'secret', status_code=500)
        self.assertIn('X-Request-ID', response)
        self.assertIn('status="500"', self.scrape().content.decode())


class MultiprocessMetricsTests(SimpleTestCase):
    def test_two_workers_are_aggregated(self):
        import os
        import subprocess
        import sys
        import tempfile
        from pathlib import Path
        with tempfile.TemporaryDirectory() as directory:
            env = {**os.environ, 'PROMETHEUS_MULTIPROC_DIR': directory}
            backend = str(Path(__file__).resolve().parents[2])
            for count in [3, 4]:
                subprocess.run([sys.executable, '-c',
                    'from flow.observability import REQUESTS; REQUESTS.labels("GET", "/api/events", "200").inc(' + str(count) + ')'],
                    env=env, cwd=backend, check=True, capture_output=True)
            result = subprocess.run([sys.executable, '-c',
                'from prometheus_client import CollectorRegistry, generate_latest, multiprocess; r=CollectorRegistry(); multiprocess.MultiProcessCollector(r); print(generate_latest(r).decode())'],
                env=env, cwd=backend, check=True, capture_output=True, text=True)
            samples = [s for f in text_string_to_metric_families(result.stdout) for s in f.samples]
            self.assertTrue(any(s.name == 'tflow_http_requests_total' and s.value == 7 for s in samples))
