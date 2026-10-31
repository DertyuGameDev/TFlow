"""Reproducible demonstration data, explicitly opt-in on a development database."""
from datetime import timedelta
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone
from flow.models import User, Event, Room, Activity, EventRegistration, Registration


class Command(BaseCommand):
    help = 'Create demo accounts and two parallel online flows; development only.'

    @transaction.atomic
    def handle(self, *args, **options):
        if not settings.DEBUG or settings.IS_VERCEL:
            raise CommandError('Demo data is permitted only in local DEBUG mode')
        accounts = []
        for role in ['organizer', 'participant']:
            email = f'{role}@demo.example.test'
            user, created = User.objects.get_or_create(email=email, defaults={'role': role, 'name': 'Демо ' + role})
            if not created and (user.role != role or not user.check_password('Demo-flow-2026!')):
                raise CommandError('Existing account conflicts with demo identity; nothing changed')
            if created:
                user.set_password('Demo-flow-2026!')
                user.save()
            accounts.append(user)
        helper, created = User.objects.get_or_create(email='helper@demo.example.test', defaults={'role':'participant','name':'Демо помощник'})
        if not created and (helper.role != 'participant' or not helper.check_password('Demo-flow-2026!')):
            raise CommandError('Existing helper account conflicts with demo identity; nothing changed')
        if created:
            helper.set_password('Demo-flow-2026!'); helper.save()
        start = (timezone.now() + timedelta(days=7)).replace(hour=12, minute=0, second=0, microsecond=0)
        event, _ = Event.objects.get_or_create(id='demo-parallel-flows', defaults={
            'owner': accounts[0], 'title': 'Демо: два параллельных вебинара',
            'description': 'Тестовое событие для проверки флоу, регистрации, QR и ключей доступа.',
            'starts_at': start, 'ends_at': start + timedelta(hours=3),
            'city': 'Онлайн', 'venue': 'ТФлоу', 'format': 'Онлайн',
            'topic': 'Разработка', 'kind': 'Конференция', 'status': 'published',
        })
        if event.owner_id != accounts[0].pk:
            raise CommandError('Demo event ID is already used by another owner')
        for number, title in enumerate(['Python', 'Django'], 1):
            room, _ = Room.objects.get_or_create(id=f'demo-room-{number}', defaults={'event': event, 'name': title, 'capacity': 20, 'is_online': True})
            Activity.objects.get_or_create(id=f'demo-flow-{number}', defaults={
                'event': event, 'room': room, 'title': title, 'starts_at': event.starts_at,
                'ends_at': event.starts_at + timedelta(hours=1), 'capacity': 20,
            })
        onsite, created = Event.objects.get_or_create(id='demo-onsite', defaults={
            'owner':accounts[0], 'title':'Демо: конференция без накладок', 'description':'Запись, очередь, QR и переносы в двух аудиториях.',
            'starts_at':start+timedelta(days=1), 'ends_at':start+timedelta(days=1,hours=4),
            'city':'Мурманск', 'venue':'Учебный центр', 'format':'Очно', 'topic':'Разработка', 'kind':'Конференция','status':'published',
        })
        if onsite.owner_id != accounts[0].pk: raise CommandError('Demo event belongs to another owner')
        for index, title in enumerate(['Лекция с очередью','Параллельная лекция','Практикум'],1):
            room_id=1 if index in [1,3] else 2
            room,_=Room.objects.get_or_create(id=f'demo-hall-{room_id}',defaults={'event':onsite,'name':f'Зал {room_id}','capacity':20})
            offset=timedelta(hours=2) if index==3 else timedelta()
            activity,_=Activity.objects.get_or_create(id=f'demo-onsite-flow-{index}',defaults={'event':onsite,'room':room,'title':title,'starts_at':onsite.starts_at+offset,'ends_at':onsite.starts_at+offset+timedelta(hours=1),'capacity':1 if index==1 else 20})
            if created and index==1:
                EventRegistration.objects.create(user=helper,event=onsite)
                Registration.objects.create(user=helper,activity=activity)
        self.stdout.write('Helper: helper@demo.example.test; password: Demo-flow-2026!')
        self.stdout.write('Demo ready: organizer@demo.example.test / participant@demo.example.test; password: Demo-flow-2026!')
