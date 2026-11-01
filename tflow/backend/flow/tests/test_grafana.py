from io import BytesIO
from unittest.mock import Mock, patch

from django.test import TestCase, override_settings
from flow.models import User
from .test_api import FAST_HASHER


@override_settings(PASSWORD_HASHERS=FAST_HASHER, GRAFANA_VIEWERS=['owner@example.test'])
class GrafanaProxyTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user('owner@example.test', '1', role='organizer')

    def test_anonymous_users_are_sent_to_existing_login(self):
        self.assertEqual(self.client.get('/grafana/').status_code, 302)

    @patch('flow.grafana.build_opener')
    def test_other_organizers_and_participants_cannot_reach_monitoring(self, opener):
        for email, role in [('other@example.test', 'organizer'), ('person@example.test', 'participant')]:
            user = User.objects.create_user(email, '1', role=role)
            self.client.force_login(user)
            self.assertEqual(self.client.get('/grafana/').status_code, 403)
        opener.assert_not_called()

    @patch('flow.grafana.build_opener')
    def test_proxy_uses_viewer_identity_and_never_forwards_session_or_client_authorization(self, opener):
        self.client.force_login(self.owner)
        response = BytesIO(b'<html>Grafana</html>')
        response.code = 200
        response.headers = {'Content-Type': 'text/html'}
        opener.return_value.open.return_value = response
        result = self.client.get('/grafana/d/tflow-production/tflow', HTTP_AUTHORIZATION='Bearer private')
        self.assertEqual(result.status_code, 200)
        request = opener.return_value.open.call_args.args[0]
        self.assertEqual(request.full_url, 'http://127.0.0.1:13001/grafana/d/tflow-production/tflow')
        self.assertNotIn('Cookie', request.headers)
        self.assertNotIn('Authorization', request.headers)
        self.assertEqual(request.get_header('X-webauth-user'), 'tflow-viewer')

    @patch('flow.grafana.build_opener')
    def test_cross_origin_queries_and_all_configuration_writes_are_blocked(self, opener):
        self.client.force_login(self.owner)
        self.assertEqual(self.client.post('/grafana/api/ds/query', {}, HTTP_ORIGIN='https://evil.test').status_code, 403)
        self.assertEqual(self.client.post('/grafana/api/admin/users', {}, HTTP_ORIGIN='http://testserver').status_code, 405)
        self.assertEqual(self.client.delete('/grafana/api/dashboards/uid/tflow-production').status_code, 405)
        opener.assert_not_called()

    @patch('flow.grafana.build_opener')
    def test_same_origin_read_query_can_reach_prometheus(self, opener):
        self.client.force_login(self.owner)
        response = BytesIO(b'{"results":{}}')
        response.code = 200
        response.headers = {'Content-Type': 'application/json'}
        opener.return_value.open.return_value = response
        result = self.client.post('/grafana/api/ds/query', '{}', content_type='application/json', HTTP_ORIGIN='http://testserver')
        self.assertEqual(result.status_code, 200)
        self.assertEqual(opener.return_value.open.call_args.args[0].method, 'POST')
