from io import StringIO
from django.core.management import call_command, CommandError
from django.test import TestCase, override_settings
from flow.models import User, Event, Room, Activity


class DemoDataTests(TestCase):
    @override_settings(DEBUG=True, IS_VERCEL=False)
    def test_repeatable_data_with_parallel_rooms_and_working_roles(self):
        for _ in range(2):
            call_command('seed_demo', stdout=StringIO())
        self.assertEqual(User.objects.count(), 3)
        self.assertEqual(Event.objects.count(), 2)
        self.assertEqual(Room.objects.filter(is_online=True).count(), 2)
        flows = list(Activity.objects.filter(event_id="demo-parallel-flows"))
        self.assertEqual(len(flows), 2)
        self.assertEqual(flows[0].starts_at, flows[1].starts_at)
        self.assertNotEqual(flows[0].room_id, flows[1].room_id)
        for role in ['organizer', 'participant']:
            user = User.objects.get(email=f'{role}@demo.example.test')
            self.assertEqual(user.role, role)
            self.assertTrue(self.client.login(username=user.email, password='Demo-flow-2026!'))

    @override_settings(DEBUG=False)
    def test_production_is_refused_without_data_changes(self):
        with self.assertRaises(CommandError):
            call_command('seed_demo', stdout=StringIO())
        self.assertFalse(User.objects.exists())
