from io import StringIO
from unittest.mock import patch

from django.core.management import CommandError, call_command
from django.db.migrations.recorder import MigrationRecorder
from django.contrib.sessions.models import Session
from django.test import TransactionTestCase, override_settings
from django.utils import timezone

from flow.models import Activity, Community, Event, ScheduleLock, User
from .test_api import FAST_HASHER


@override_settings(PASSWORD_HASHERS=FAST_HASHER, DEBUG=False)
class DefenseDatasetTests(TransactionTestCase):
    def setUp(self):
        self.old = User.objects.create_user('old@example.test', 'old')
        Session.objects.create(session_key='old-session', session_data='old',
                               expire_date=timezone.now())

    def test_reset_requires_both_explicit_flags(self):
        for options in ({}, {'yes': True}, {'reset_all': True}):
            with self.subTest(options=options), self.assertRaises(CommandError):
                call_command('prepare_defense', stdout=StringIO(), **options)
            self.assertTrue(User.objects.filter(pk=self.old.pk).exists())

    def test_complete_reset_and_fixture_accounts_work_in_production_mode(self):
        migrations = MigrationRecorder.Migration.objects.count()
        call_command('prepare_defense', reset_all=True, yes=True, stdout=StringIO())
        self.assertFalse(User.objects.filter(pk=self.old.pk).exists())
        self.assertFalse(Session.objects.exists())
        self.assertEqual([User.objects.count(), Event.objects.count(), Activity.objects.count(), Community.objects.count()], [12, 11, 30, 4])
        self.assertEqual(MigrationRecorder.Migration.objects.count(), migrations)
        self.assertTrue(ScheduleLock.objects.filter(pk=1).exists())
        for email, password, role in [('test@jury.example.test', 'test', 'organizer'),
                                      ('other@jury.example.test', 'test', 'organizer'),
                                      ('1@jury.example.test', '1', 'participant')]:
            user = User.objects.get(email=email)
            self.assertTrue(user.check_password(password))
            self.assertEqual(user.role, role)
            self.assertFalse(user.is_staff or user.is_superuser)
            self.assertEqual(self.client.post('/login/', {'username': email, 'password': password}, secure=True).status_code, 302)
            self.client.post('/logout/', secure=True)
        self.assertEqual(Event.objects.get(pk='jury-event-04').owner.email, 'other@jury.example.test')

    def test_failed_seed_restores_original_data_transactionally(self):
        from flow.management.commands import prepare_defense
        original = prepare_defense.call_command

        def fail_seed(name, **options):
            if name == 'seed_jury':
                raise CommandError('simulated fixture failure')
            return original(name, **options)

        with patch.object(prepare_defense, 'call_command', side_effect=fail_seed), self.assertRaises(CommandError):
            call_command('prepare_defense', reset_all=True, yes=True, stdout=StringIO())
        self.assertTrue(User.objects.filter(pk=self.old.pk).exists())
        self.assertTrue(Session.objects.filter(pk='old-session').exists())

    def test_production_seed_cannot_add_accounts_to_an_existing_database(self):
        with self.assertRaises(CommandError):
            call_command('seed_jury', allow_production=True, stdout=StringIO())
        self.assertEqual(User.objects.count(), 1)
