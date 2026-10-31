"""Site notifications survive removal of the unused email outbox."""
from django.db import connection, transaction
from django.db.migrations.executor import MigrationExecutor
from django.test import TestCase, TransactionTestCase
from flow.models import Notification, User
from flow.notifications import create_notifications


class SiteNotificationTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user('notice@example.test', name='Участник')

    def test_empty_batch_does_not_query_database(self):
        with self.assertNumQueries(0):
            self.assertEqual(create_notifications([]), [])

    def test_created_messages_are_unread_and_visible_to_recipient(self):
        saved = create_notifications([Notification(user=self.user, message='Новое событие')])
        self.client.force_login(self.user)
        response = self.client.get('/api/notifications')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['items'][0]['id'], saved[0].pk)
        self.assertFalse(Notification.objects.get(pk=saved[0].pk).read)

    def test_business_rollback_removes_new_message(self):
        with self.assertRaises(RuntimeError):
            with transaction.atomic():
                create_notifications([Notification(user=self.user, message='Не сохранять')])
                raise RuntimeError('business operation failed')
        self.assertFalse(Notification.objects.exists())


class RemoveEmailOutboxMigrationTests(TransactionTestCase):
    def test_upgrade_preserves_accounts_and_site_messages(self):
        executor = MigrationExecutor(connection)
        latest = executor.loader.graph.leaf_nodes()
        before = [('flow', '0027_alter_notification_kind')]
        try:
            executor.migrate(before)
            apps = executor.loader.project_state(before).apps
            user = apps.get_model('flow', 'User').objects.create(email='upgrade@example.test', name='Участник')
            notice = apps.get_model('flow', 'Notification').objects.create(user=user, message='Сохранить', read=True)
            outbox = apps.get_model('flow', 'NotificationEmail')
            outbox.objects.create(notification=notice)
            executor = MigrationExecutor(connection)
            executor.migrate(latest)
            apps = executor.loader.project_state(latest).apps
            self.assertEqual(apps.get_model('flow', 'User').objects.get(pk=user.pk).email, 'upgrade@example.test')
            kept = apps.get_model('flow', 'Notification').objects.get(pk=notice.pk)
            self.assertEqual(kept.message, 'Сохранить')
            self.assertTrue(kept.read)
            self.assertNotIn(outbox._meta.db_table, connection.introspection.table_names())
        finally:
            MigrationExecutor(connection).migrate(latest)
