"""Business audiences and authenticated, durable Web Push delivery."""
import base64
from datetime import timedelta
import io
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
from unittest.mock import patch
import uuid
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import serialization
from django.core.management import call_command
from django.db import transaction, connection
from django.test import Client, TestCase, TransactionTestCase, override_settings
from django.utils import timezone
from flow import services, push
from flow.contracts import FlowError
from flow.models import (Community, EventRegistration, EventWaitlistEntry, Membership, Notification,
                         PushDelivery, PushSubscription, Registration, User, WaitlistEntry)
from flow.notifications import create_notifications, online_attendance
from flow.reminders import send_due_reminders
from .test_api import FAST_HASHER, Scenario


def subscription(path='device'):
    key=ec.generate_private_key(ec.SECP256R1()).public_key().public_bytes(serialization.Encoding.X962,serialization.PublicFormat.UncompressedPoint)
    enc=lambda value:base64.urlsafe_b64encode(value).rstrip(b'=').decode()
    return {'endpoint':'https://fcm.googleapis.com/fcm/send/'+path,'keys':{'p256dh':enc(key),'auth':enc(b'0'*16)}}


@override_settings(PASSWORD_HASHERS=FAST_HASHER)
class AudienceTests(Scenario, TestCase):
    def setUp(self):
        super().setUp();self.publish()
        self.club=Community.objects.create(owner=self.owner,name='Клуб',description='Описание',topic='Наука',color='blue')
        self.event.community=self.club;self.event.save()
        self.subscriber=User.objects.create_user('subscriber@example.test',name='Подписчик')
        self.unsubscribed=User.objects.create_user('silent@example.test',name='Без подписки')
        self.inactive=User.objects.create_user('inactive@example.test',name='Заблокирован',is_active=False)
        for user,enabled in [(self.subscriber,True),(self.person,True),(self.unsubscribed,False),(self.inactive,True)]:
            Membership.objects.create(user=user,community=self.club,notify_events=enabled)
        EventRegistration.objects.create(user=self.person,event=self.event)
        EventWaitlistEntry.objects.create(user=self.other,event=self.event)

    def test_activity_change_reaches_tickets_event_queue_and_club_once(self):
        WaitlistEntry.objects.create(user=self.person,activity=self.a)
        services.save_activity(self.owner,{'speaker':'Новый спикер','description':'Новая программа'},activity_id=self.a.pk)
        notices=Notification.objects.filter(kind="info")
        self.assertCountEqual(notices.values_list('user_id',flat=True),[self.person.pk,self.other.pk,self.subscriber.pk])
        for n in notices:
            self.assertEqual(n.activity_id,self.a.pk)
            self.assertIn('Спикер: не указано → Новый спикер',n.message)
            self.assertIn('Описание:',n.message)

    def test_unsubscribed_ticket_holder_still_gets_critical_change_and_noop_does_not_repeat(self):
        Membership.objects.filter(user=self.person).update(notify_events=False)
        services.save_activity(self.owner,{'speaker':'Докладчик'},activity_id=self.a.pk)
        before=Notification.objects.count()
        services.save_activity(self.owner,{'speaker':'Докладчик'},activity_id=self.a.pk)
        self.assertEqual(Notification.objects.count(),before)
        self.assertTrue(Notification.objects.filter(user=self.person).exists())

    def test_draft_changes_do_not_leak_to_subscribers_or_legacy_tickets(self):
        self.event.status='draft';self.event.save()
        services.save_activity(self.owner,{'speaker':'Черновик'},activity_id=self.a.pk)
        self.assertFalse(Notification.objects.exists())

    def test_failed_save_or_outbox_rolls_back_business_and_notice(self):
        with patch('flow.notifications.Notification.objects.bulk_create',side_effect=RuntimeError('fail')):
            with self.assertRaises(RuntimeError):
                services.save_activity(self.owner,{'speaker':'Не сохранить'},activity_id=self.a.pk)
        self.a.refresh_from_db();self.assertEqual(self.a.speaker,'')
        self.assertFalse(Notification.objects.exists())

    def test_requirements_and_room_changes_have_details(self):
        services.set_requirements(self.owner,self.event.pk,{'required_profile_fields':['phone']})
        self.assertIn('Телефон',Notification.objects.get(user=self.person).message)
        services.save_room(self.owner,{'name':'Новый зал','capacity':4},room_id=self.r1.pk)
        self.assertTrue(Notification.objects.filter(user=self.person,message__contains='Зал 1 → Новый зал').exists())

    def test_online_attendance_is_not_a_notification_per_segment(self):
        for _ in range(5):online_attendance(self.person,self.event,self.a)
        self.assertEqual(Notification.objects.filter(kind='attendance').count(),1)

    def test_event_reminders_restart_reschedule_and_cancel(self):
        now=timezone.now();self.event.starts_at=now+timedelta(minutes=20);self.event.ends_at=now+timedelta(hours=2);self.event.save()
        self.assertEqual(send_due_reminders(now),1)
        self.assertEqual(send_due_reminders(now),0)
        self.event.starts_at+=timedelta(minutes=5);self.event.save()
        self.assertEqual(send_due_reminders(now),1)
        EventRegistration.objects.filter(user=self.person).delete()
        self.assertEqual(send_due_reminders(now),0)
        self.assertEqual(Notification.objects.filter(kind='event_reminder').count(),2)

    def test_ticket_and_cancel_confirmations_are_idempotent(self):
        services.enroll_event(self.person,self.event.pk)
        self.assertFalse(Notification.objects.exists())
        services.cancel_event(self.person,self.event.pk)
        count=Notification.objects.filter(user=self.person).count()
        services.cancel_event(self.person,self.event.pk)
        self.assertEqual(Notification.objects.filter(user=self.person).count(),count)


@override_settings(PASSWORD_HASHERS=FAST_HASHER,WEB_PUSH_ENABLED=True)
class PushApiTests(Scenario,TransactionTestCase):
    def setUp(self):
        super().setUp();self.directory=tempfile.TemporaryDirectory();self.addCleanup(self.directory.cleanup)
        root=Path(self.directory.name)
        self.config=override_settings(WEB_PUSH_PRIVATE_KEY=root/'private.pem',WEB_PUSH_PUBLIC_KEY=root/'public.key',NOTIFICATION_WORKER_ROOT=root/'worker')
        self.config.enable();self.addCleanup(self.config.disable)
        call_command('setup_web_push',private=str(root/'private.pem'),public=str(root/'public.key'),stdout=io.StringIO())
        self.value=subscription()

    def subscribe(self,client=None,value=None):
        return self.request('push/subscriptions','post',value or self.value,client=client or self.participant)

    def test_subscription_is_idempotent_transactional_and_not_exposed(self):
        self.subscribe();self.subscribe()
        self.assertEqual(PushSubscription.objects.count(),1)
        self.assertEqual(PushDelivery.objects.count(),1)
        state=self.request('push/config',client=self.participant)
        self.assertTrue(state['deviceEnabled']);self.assertNotIn('endpoint',json.dumps(state))
        self.assertTrue(self.participant.cookies[push.COOKIE]['httponly'])
        with self.assertRaises(RuntimeError):
            with transaction.atomic():
                create_notifications([Notification(user=self.person,message='rollback')])
                raise RuntimeError()
        self.assertEqual(PushDelivery.objects.count(),1)

    def test_foreign_detail_is_private_and_csrf_required(self):
        self.subscribe();notice=Notification.objects.get(user=self.person)
        self.request('notifications/'+notice.pk,client=self.stranger,status=404)
        self.request('notifications/summary',client=Client(),status=401)
        client=Client(enforce_csrf_checks=True);client.force_login(self.person)
        for path in ['push/subscriptions','push/unsubscribe','push/test']:
            self.assertEqual(client.post('/api/'+path,data='{}',content_type='application/json').status_code,403)
        self.assertIn('no-store',self.participant.get('/api/notifications/'+notice.pk)['Cache-Control'])

    def test_subscription_disallows_internal_redirect_and_invalid_curve_endpoints(self):
        for endpoint in ['http://fcm.googleapis.com/a','https://127.0.0.1/a','https://fcm.googleapis.com.evil.test/a',
                         'https://fcm.googleapis.com@127.0.0.1/a','https://fcm.googleapis.com:8443/a','https://fcm.googleapis.com/a#x']:
            with self.subTest(endpoint=endpoint),self.assertRaises(FlowError):
                push.validate_subscription({**self.value,'endpoint':endpoint})
        with self.assertRaises(FlowError):push.validate_subscription({**self.value,'keys':{'auth':'bad','p256dh':'bad'}})

    def test_rebound_skips_previous_account_and_logout_only_detaches_own_device(self):
        self.subscribe();device=PushSubscription.objects.get();generation=device.generation
        self.subscribe(client=self.stranger)
        device.refresh_from_db();self.assertEqual(device.user,self.other);self.assertNotEqual(device.generation,generation)
        self.assertEqual(PushDelivery.objects.filter(notification__user=self.person,status='skipped').count(),1)
        self.participant.post('/logout/')
        self.assertTrue(PushSubscription.objects.filter(pk=device.pk).exists())
        self.stranger.post('/logout/')
        self.assertFalse(PushSubscription.objects.exists())

    def test_device_limit_and_test_rate_limit(self):
        self.subscribe()
        self.request('push/test','post',{},client=self.participant)
        self.request('push/test','post',{},client=self.participant,status=429,code='TOO_MANY_REQUESTS')
        for i in range(9):
            value=subscription(str(i));PushSubscription.objects.create(user=self.person,endpoint=value['endpoint'],keys=value['keys'])
        self.request('push/subscriptions','post',subscription('eleventh'),client=self.participant,status=409,code='PUSH_DEVICE_LIMIT')
        self.subscribe() # existing binding still works at the limit

    def test_real_encryption_vapid_claims_and_redirect_protection_offline(self):
        self.subscribe()
        with patch('requests.Session.request', return_value=SimpleNamespace(status_code=201, content=b'', text='', headers={})) as request:
            push.deliver(PushDelivery.objects.get().pk)
        self.assertEqual(PushDelivery.objects.get().status, 'sent')
        kwargs=request.call_args.kwargs
        self.assertFalse(kwargs['allow_redirects'])
        self.assertIn('vapid t=', kwargs['headers']['Authorization'] if 'Authorization' in kwargs['headers'] else kwargs['headers']['authorization'])
        self.assertEqual(kwargs['headers']['content-encoding'], 'aes128gcm')

    def test_cancelled_and_rescheduled_reminders_are_skipped_before_network(self):
        self.subscribe();PushDelivery.objects.all().delete()
        self.publish();EventRegistration.objects.create(user=self.person,event=self.event)
        n=create_notifications([Notification(user=self.person,event=self.event,kind='event_reminder',data={'starts_at':self.event.starts_at.isoformat()},message='Reminder')])[0]
        EventRegistration.objects.filter(user=self.person).delete()
        with patch('pywebpush.webpush') as send:
            push.deliver(n.push_deliveries.get().pk);send.assert_not_called()
        self.assertEqual(n.push_deliveries.get().status,'skipped')
        EventRegistration.objects.create(user=self.person,event=self.event)
        n2=create_notifications([Notification(user=self.person,event=self.event,kind='event_reminder',data={'starts_at':'old'},message='Old reminder')])[0]
        with patch('pywebpush.webpush') as send:
            push.deliver(n2.push_deliveries.get().pk);send.assert_not_called()
        self.assertEqual(n2.push_deliveries.get().status,'skipped')

    def test_keypair_survives_redeploy_and_mismatch_is_not_silently_rotated(self):
        root=Path(self.directory.name);before=(root/'private.pem').read_bytes()
        call_command('setup_web_push',private=str(root/'private.pem'),public=str(root/'public.key'),stdout=io.StringIO())
        self.assertEqual((root/'private.pem').read_bytes(),before)
        self.assertEqual((root/'private.pem').stat().st_mode & 0o777,0o600)
        (root/'public.key').write_text('wrong')
        with self.assertRaises(RuntimeError):call_command('setup_web_push',private=str(root/'private.pem'),public=str(root/'public.key'),stdout=io.StringIO())


@override_settings(PASSWORD_HASHERS=FAST_HASHER,WEB_PUSH_ENABLED=True)
class PushDeliveryTests(TransactionTestCase):
    def setUp(self):
        self.directory=tempfile.TemporaryDirectory();self.addCleanup(self.directory.cleanup)
        root=Path(self.directory.name);(root/'private').touch();(root/'public').write_text('test')
        self.config=override_settings(WEB_PUSH_PRIVATE_KEY=root/'private',WEB_PUSH_PUBLIC_KEY=root/'public',WEB_PUSH_SUBJECT='https://tflow.test/')
        self.config.enable();self.addCleanup(self.config.disable)
        self.user=User.objects.create_user('push@example.test',name='Участник');value=subscription()
        self.device=PushSubscription.objects.create(user=self.user,endpoint=value['endpoint'],keys=value['keys'])
        self.notice=create_notifications([Notification(user=self.user,message='Private detail')])[0]
        self.job=PushDelivery.objects.get()

    @patch('pywebpush.webpush')
    def test_network_is_outside_transaction_and_provider_gets_encrypted_id_only(self,send):
        def accept(**kwargs):
            self.assertFalse(connection.in_atomic_block)
            self.assertEqual(json.loads(kwargs['data']),{'noticeId':self.notice.pk})
            self.assertNotIn('Private detail',kwargs['data'])
            return SimpleNamespace(status_code=201)
        send.side_effect=accept
        self.assertEqual(push.deliver_due(),1)
        self.job.refresh_from_db();self.assertEqual(self.job.status,'sent');self.assertEqual(self.job.attempts,1)
        self.assertEqual(push.deliver_due(),0)

    @patch('pywebpush.webpush')
    def test_temporary_failure_retries_expired_subscription_is_disabled(self,send):
        send.return_value=SimpleNamespace(status_code=503)
        push.deliver_due();self.job.refresh_from_db()
        self.assertEqual(self.job.status,'pending');self.assertGreater(self.job.due_at,timezone.now())
        PushDelivery.objects.filter(pk=self.job.pk).update(due_at=timezone.now())
        send.return_value=SimpleNamespace(status_code=410);push.deliver_due()
        self.device.refresh_from_db();self.job.refresh_from_db()
        self.assertFalse(self.device.enabled);self.assertEqual(self.job.status,'failed')

    @patch('pywebpush.webpush')
    def test_crashed_lease_recovery_and_retry_limit(self,send):
        PushDelivery.objects.filter(pk=self.job.pk).update(lease_until=timezone.now()+timedelta(minutes=1))
        self.assertEqual(push.deliver_due(),0)
        PushDelivery.objects.filter(pk=self.job.pk).update(lease_until=timezone.now()-timedelta(seconds=1),attempts=7)
        send.side_effect=RuntimeError('sensitive provider endpoint')
        self.assertEqual(push.deliver_due(),1);self.job.refresh_from_db()
        self.assertEqual(self.job.status,'failed');self.assertEqual(self.job.last_error,'DELIVERY_ERROR')

    @patch('pywebpush.webpush')
    def test_read_and_rebound_messages_are_not_sent(self,send):
        self.notice.read=True;self.notice.save();push.deliver_due()
        self.job.refresh_from_db();self.assertEqual(self.job.status,'skipped');send.assert_not_called()
        self.notice.read=False;self.notice.save();self.device.generation=uuid.uuid4();self.device.save()
        PushDelivery.objects.filter(pk=self.job.pk).update(status='pending',lease_until=None)
        push.deliver_due();send.assert_not_called()

    @patch('pywebpush.webpush')
    def test_crash_on_last_attempt_cannot_create_an_unbounded_retry_loop(self,send):
        PushDelivery.objects.filter(pk=self.job.pk).update(attempts=8,lease_until=timezone.now()-timedelta(seconds=1))
        self.assertEqual(push.deliver_due(),0);self.job.refresh_from_db()
        self.assertEqual(self.job.status,'failed');self.assertEqual(self.job.last_error,'RETRY_LIMIT');send.assert_not_called()

    @override_settings(WEB_PUSH_GOOGLE_EDGE=True,WEB_PUSH_MOZILLA_EDGE=True)
    def test_provider_route_retains_http_host_sni_and_certificate_validation(self):
        import requests
        with push.delivery_session() as session:
            for host,edge in [('fcm.googleapis.com','www.googleapis.com'),('updates.push.services.mozilla.com','199.232.45.91')]:
                request=requests.Request('POST','https://'+host+'/private-token').prepare()
                adapter=session.get_adapter(request.url)
                with patch.object(adapter.poolmanager,'connection_from_host') as pool:
                    adapter.get_connection_with_tls_context(request,True)
                    pool.assert_called_once_with(edge,scheme='https',pool_kwargs={'server_hostname':host,'assert_hostname':host})
                adapter.add_headers(request)
                self.assertEqual(request.headers['Host'],host)
            self.assertTrue(session.verify)
