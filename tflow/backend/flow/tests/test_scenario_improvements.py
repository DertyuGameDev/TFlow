from datetime import timedelta
from unittest.mock import patch
from django.test import TestCase, override_settings
from django.utils import timezone
from flow.models import Activity, ActivityAttendance, ActivityReminder, CheckIn, Event, EventRegistration, Notification, Registration, Room, WaitlistEntry
from flow.reminders import send_due_reminders
from flow.serializers import activities_for, activity_json
from flow.contracts import FlowError
from flow import services
from .test_api import FAST_HASHER, Scenario


@override_settings(PASSWORD_HASHERS=FAST_HASHER)
class ScenarioImprovementsTests(Scenario, TestCase):
    def setUp(self):
        super().setUp()
        self.publish()
        EventRegistration.objects.create(user=self.person, event=self.event)

    def scan(self, activity=None, **kwargs):
        body = {'qr': str(self.person.pass_token)}
        if activity: body['activity_id'] = activity.pk
        return self.request(f'events/{self.event.pk}/check-in', 'post', body, **kwargs)

    def test_event_entry_and_two_activity_visits_are_distinct_and_single_use(self):
        Registration.objects.create(user=self.person, activity=self.a)
        Registration.objects.create(user=self.person, activity=self.c)
        self.scan()
        self.scan(self.a)
        self.scan(self.c)
        self.scan(self.a, status=409, code='ALREADY_CHECKED_IN')
        self.assertEqual(CheckIn.objects.count(), 1)
        self.assertEqual(ActivityAttendance.objects.count(), 2)
        data = activity_json(activities_for(self.person).get(pk=self.a.pk))
        self.assertTrue(data['attended'])
        self.assertEqual(data['attended_count'], 1)

    def test_activity_visit_requires_registration_and_participant_cannot_scan(self):
        self.scan(self.a, status=409, code='NOT_REGISTERED')
        self.scan(self.a, client=self.participant, status=403, code='FORBIDDEN')
        self.assertFalse(ActivityAttendance.objects.exists())

    def test_open_activity_admits_event_ticket_holder_without_seat_reservation(self):
        self.a.registration_required = False
        self.a.save()
        self.scan(self.a)
        self.assertFalse(Registration.objects.exists())
        self.assertEqual(CheckIn.objects.count(), 1)

    def test_delegate_scanner_is_limited_to_its_event_and_hides_contacts(self):
        from flow.access_keys import issue_key
        _, key = issue_key(self.owner, self.event.pk)
        Registration.objects.create(user=self.person, activity=self.a)
        data = self.request('access-keys/resolve','post',{'key':key},client=self.stranger)
        self.assertIn(self.a.pk, [a['id'] for a in data['scan_activities']])
        data = self.request('access-keys/check-in', 'post', {'key':key,'qr':str(self.person.pass_token),'activity_id':self.a.pk},client=self.stranger)
        self.assertNotIn('email', data['attendee'])
        self.assertNotIn('profile_data', data['attendee'])
        self.assertEqual(ActivityAttendance.objects.get().checked_by_id, self.other.pk)
        unrelated = Activity.objects.create(event=Event.objects.create(owner=self.owner,title='Other',description='',starts_at=self.start,ends_at=self.event.ends_at,city='',venue='',format='Очно',topic='',kind=''),room=self.r1,title='Foreign',starts_at=self.start,ends_at=self.a.ends_at,capacity=1)
        self.request('access-keys/check-in','post',{'key':key,'qr':str(self.person.pass_token),'activity_id':unrelated.pk},client=self.stranger,status=404,code='NOT_FOUND')

    def test_ended_activity_refuses_checkin(self):
        self.a.ends_at = timezone.now()-timedelta(seconds=1)
        self.a.starts_at = self.a.ends_at-timedelta(hours=1)
        self.a.save()
        self.scan(self.a,status=409,code='SCAN_CLOSED')

    def test_conflict_explains_clashing_title_and_offers_valid_alternatives(self):
        response = self.request(f'activities/{self.c.pk}','patch',{
            'title':self.c.title,'description':'','speaker':'','room_id':self.r1.pk,
            'starts_at':round(self.a.starts_at.timestamp()*1000),'ends_at':round(self.a.ends_at.timestamp()*1000),'capacity':1,
        }, status=409,code='ROOM_CONFLICT')
        self.assertIn(self.a.title,response['error'])
        self.assertIn('Подходящие варианты:',response['error'])
        self.c.refresh_from_db()
        self.assertNotEqual(self.c.starts_at,self.a.starts_at)

    def test_participant_conflict_message_does_not_expose_names_or_other_organizers_events(self):
        from flow.models import User
        foreign_owner=User.objects.create_user('private-host@example.test',None,role='organizer')
        foreign_event=Event.objects.create(owner=foreign_owner,title='Закрытое чужое событие',description='',starts_at=self.start,ends_at=self.event.ends_at,city='',venue='',format='Очно',topic='',kind='')
        foreign_room=Room.objects.create(event=foreign_event,name='Private',capacity=10)
        foreign_activity=Activity.objects.create(event=foreign_event,room=foreign_room,title='Чужая приватная лекция',starts_at=self.start,ends_at=self.a.ends_at,capacity=10)
        Registration.objects.create(user=self.person,activity=foreign_activity)
        Registration.objects.create(user=self.person,activity=self.d)
        self.d.room=Room.objects.create(event=self.event,name='Свободная комната',capacity=10)
        self.d.starts_at,self.d.ends_at = self.a.starts_at,self.a.ends_at
        with self.assertRaises(FlowError) as error:
            services.validate_activity(self.d)
        message=str(error.exception)
        self.assertEqual(error.exception.code,'ENROLLED_CONFLICT')
        self.assertIn('Затронуто участников: 1',message)
        self.assertNotIn(self.person.email,message)
        self.assertNotIn(foreign_activity.title,message)
        self.assertNotIn(foreign_event.title,message)

    def test_change_notice_contains_old_new_time_room_and_activity_target(self):
        Registration.objects.create(user=self.person,activity=self.c)
        services.save_activity(self.owner, {'starts_at':self.c.starts_at+timedelta(hours=4),'ends_at':self.c.ends_at+timedelta(hours=4),'room_id':self.r2.pk}, activity_id=self.c.pk)
        notice=Notification.objects.get(user=self.person)
        self.assertEqual(notice.activity_id,self.c.pk)
        self.assertIn('Время:',notice.message)
        self.assertIn('Зал 1 → Зал 2',notice.message)
        self.assertIn('МСК',notice.message)

    def test_swapped_activity_notice_opens_its_flow(self):
        Registration.objects.create(user=self.person,activity=self.a)
        self.request(f'activities/{self.a.pk}/swap','post',{'other_id':self.c.pk})
        notice=Notification.objects.get(user=self.person)
        self.assertEqual(notice.activity_id,self.a.pk)
        self.assertIn('Время:',notice.message)

    def due(self):
        now=timezone.now()
        self.a.starts_at,self.a.ends_at=now+timedelta(minutes=15),now+timedelta(minutes=75)
        self.a.save()
        Registration.objects.create(user=self.person,activity=self.a)
        return now

    def test_reminder_is_idempotent_and_rescheduling_gets_new_reminder(self):
        now=self.due()
        self.assertEqual(send_due_reminders(now),1)
        self.assertEqual(send_due_reminders(now),0)
        self.a.starts_at+=timedelta(minutes=5)
        self.a.save()
        self.assertEqual(send_due_reminders(now),1)
        self.assertEqual(ActivityReminder.objects.count(),2)
        self.assertTrue(all(n.activity_id==self.a.pk for n in Notification.objects.all()))

    def test_cancelled_or_unpublished_activity_does_not_get_reminder(self):
        now=self.due()
        self.event.status='draft';self.event.save()
        self.assertEqual(send_due_reminders(now),0)
        self.publish()
        Registration.objects.all().delete()
        self.assertEqual(send_due_reminders(now),0)

    def test_failed_reminder_transaction_can_be_retried_without_losing_message(self):
        now=self.due()
        with patch('flow.reminders.create_notifications',side_effect=RuntimeError('outbox failed')):
            with self.assertRaises(RuntimeError):send_due_reminders(now)
        self.assertFalse(ActivityReminder.objects.exists())
        self.assertEqual(send_due_reminders(now),1)

    def test_queue_reports_paused_and_resumes_after_conflict_is_cancelled(self):
        Registration.objects.create(user=self.other,activity=self.a)
        WaitlistEntry.objects.create(user=self.person,activity=self.a)
        Registration.objects.create(user=self.person,activity=self.b)
        self.assertEqual(activity_json(activities_for(self.person).get(pk=self.a.pk))['waitlist_state'],'time_conflict')
        services.cancel(self.person,self.b.pk)
        self.assertEqual(activity_json(activities_for(self.person).get(pk=self.a.pk))['waitlist_state'],'waiting')
