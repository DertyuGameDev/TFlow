"""Explicit all-account reset and complete judging dataset in one transaction."""
import json

from django.core.management import BaseCommand, CommandError, call_command
from django.db import transaction
from flow.models import Activity, Community, Event, User


class Command(BaseCommand):
    help = 'Replace all application data, including accounts, with the defense dataset.'

    def add_arguments(self, parser):
        parser.add_argument('--reset-all', action='store_true')
        parser.add_argument('--yes', action='store_true')

    @transaction.atomic
    def handle(self, *args, **options):
        if not (options['reset_all'] and options['yes']):
            raise CommandError('Both --reset-all and --yes are required to replace all accounts and data')
        call_command('reset_data', yes=True, stdout=self.stdout)
        call_command('seed_jury', allow_production=True, stdout=self.stdout)
        other = User.objects.create_user('other@jury.example.test', 'test', id='jury-user-other',
                                         role='organizer', name='Организатор другой команды')
        Event.objects.filter(pk='jury-event-04').update(owner=other, community=None)
        counts = {'users': User.objects.count(), 'events': Event.objects.count(),
                  'activities': Activity.objects.count(), 'clubs': Community.objects.count()}
        if counts != {'users': 12, 'events': 11, 'activities': 30, 'clubs': 4}:
            raise CommandError('Unexpected fixture counts; the transaction was rolled back')
        self.stdout.write(json.dumps(counts, sort_keys=True))
