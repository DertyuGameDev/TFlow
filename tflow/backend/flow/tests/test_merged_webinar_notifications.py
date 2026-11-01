from django.test import TestCase, override_settings

from flow.models import EventRegistration, EventWaitlistEntry, Notification, Registration, User
from flow.notifications import broadcast_notice
from .test_api import FAST_HASHER, Scenario


@override_settings(PASSWORD_HASHERS=FAST_HASHER)
class MergedWebinarNotificationTests(Scenario, TestCase):
    def setUp(self):
        super().setUp()
        self.publish()
        EventRegistration.objects.create(user=self.person, event=self.event)
        EventRegistration.objects.create(user=self.other, event=self.event)
        self.waiting = User.objects.create_user('waiting@example.test', 'test', name='Ожидает')
        EventWaitlistEntry.objects.create(user=self.waiting, event=self.event)

    def test_booked_flow_notice_is_scoped_and_keeps_shared_notification_metadata(self):
        Registration.objects.create(user=self.person, activity=self.a)
        broadcast_notice(self.event, self.a)
        notice = Notification.objects.get()
        self.assertEqual(notice.user_id, self.person.pk)
        self.assertEqual(notice.activity_id, self.a.pk)
        self.assertEqual(notice.kind, 'webinar')
        self.assertEqual(notice.title, 'Эфир начался')
        self.assertIn(self.a.title, notice.message)
        self.assertIn(self.event.title, notice.message)

    def test_open_flow_notice_reaches_ticket_holders_and_excludes_waiting_for_ticket(self):
        self.a.registration_required = False
        self.a.save(update_fields=['registration_required'])
        broadcast_notice(self.event, self.a, ended=True)
        self.assertEqual(set(Notification.objects.values_list('user_id', flat=True)), {self.person.pk, self.other.pk})
        self.assertFalse(Notification.objects.exclude(title='Эфир завершён').exists())
