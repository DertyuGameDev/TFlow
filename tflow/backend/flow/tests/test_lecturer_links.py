from datetime import timedelta
from unittest.mock import patch
from django.test import TestCase,override_settings
from django.utils import timezone
from flow.models import EventAccessKey, HttpBroadcast, EventRegistration
from flow import services
from .test_api import Scenario,FAST_HASHER

@override_settings(PASSWORD_HASHERS=FAST_HASHER, SESSION_COOKIE_AGE=90*86400)
class LecturerLinksTests(Scenario,TestCase):
    def setUp(self):
        super().setUp();self.publish();self.event.format='Гибрид';self.event.save();self.r1.is_online=True;self.r1.save()
        self.path=f'events/{self.event.pk}/lecturer-links'

    def ensure(self):return self.request(self.path,'post',{'operation':'ensure'})['activities']

    def test_owner_only_stable_per_activity_links_and_no_plaintext_storage(self):
        rows=self.ensure();self.assertEqual(len(rows),2)
        self.assertEqual(rows,self.ensure());self.assertEqual(EventAccessKey.objects.count(),2)
        self.assertNotEqual(rows[0]['credential'],rows[1]['credential'])
        self.assertNotIn(rows[0]['credential'],str(list(EventAccessKey.objects.values())))
        self.request(self.path,'post',{'operation':'ensure'},client=self.participant,status=403)
        self.request(self.path,client=self.participant,status=404)

    def test_lecturer_gets_only_own_activity_without_becoming_organizer(self):
        row=self.ensure()[0]
        scope=self.request('access-keys/resolve','post',{'key':row['credential']},client=self.participant)
        self.assertEqual(scope['purpose'],'webinar');self.assertEqual(scope['activity']['id'],row['id'])
        self.person.refresh_from_db();self.assertEqual(self.person.role,'participant')
        self.assertFalse(EventRegistration.objects.filter(user=self.person).exists())
        self.request(f'events/{self.event.pk}/attendance',client=self.participant,status=403)

    def test_revocation_is_durable_and_explicit_reissue_invalidates_previous_url(self):
        row=self.ensure()[0]
        self.request(self.path,'post',{'operation':'revoke','activity_id':row['id']})
        self.request('access-keys/resolve','post',{'key':row['credential']},client=self.participant,status=403)
        self.assertIsNone(next(r for r in self.ensure() if r['id']==row['id'])['credential'])
        new=self.request(self.path,'post',{'operation':'issue','activity_id':row['id']})['activities'][0]
        self.assertNotEqual(row['credential'],new['credential'])

    def test_move_preserves_link_and_uses_updated_end_after_old_expiration(self):
        row=next(r for r in self.ensure() if r['id']==self.a.pk)
        services.save_activity(self.owner,{'room_id':self.r1.pk,'starts_at':self.start+timedelta(hours=4),'ends_at':self.start+timedelta(hours=5)},activity_id=self.a.pk)
        key=EventAccessKey.objects.get(pk=row['key_id']);self.assertEqual(key.expires_at,self.start+timedelta(hours=5))
        with patch('flow.access_keys.timezone.now',return_value=self.start+timedelta(hours=2)):
            scope=self.request('access-keys/resolve','post',{'key':row['credential']},client=self.participant)
            self.assertEqual(scope['activity']['starts_at'],round((self.start+timedelta(hours=4)).timestamp()*1000))

    def test_revoking_lecturer_stops_only_broadcast_using_that_link(self):
        row=self.ensure()[0];key=EventAccessKey.objects.get(pk=row['key_id'])
        broadcast=HttpBroadcast.objects.create(event=self.event,activity_id=row['id'],active=True,publisher_key=key)
        self.request(self.path,'post',{'operation':'revoke','activity_id':row['id']})
        broadcast.refresh_from_db();self.assertFalse(broadcast.active)
