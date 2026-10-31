"""Reproducible demonstration data, explicitly opt-in on a development database."""
from datetime import timedelta
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone
from flow.models import User, Event, Room, Activity


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
        self.stdout.write('Demo ready: organizer@demo.example.test / participant@demo.example.test; password: Demo-flow-2026!')
