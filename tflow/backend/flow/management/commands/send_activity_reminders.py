import time
import logging
from django.core.management.base import BaseCommand
from flow.reminders import send_due_reminders


class Command(BaseCommand):
    help = 'Напоминания о событиях и активностях без дублей. На Spirit работает run_notification_worker.'

    def add_arguments(self, parser):
        parser.add_argument('--watch', action='store_true')

    def handle(self, *args, **options):
        try:
            while True:
                sent = send_due_reminders()
                if sent or not options['watch']:
                    self.stdout.write(f'Создано напоминаний: {sent}')
                if not options['watch']: return
                time.sleep(30)
        except KeyboardInterrupt:
            return
        except Exception:
            logging.getLogger('flow.reminders').exception('reminder_worker_failed')
            raise
