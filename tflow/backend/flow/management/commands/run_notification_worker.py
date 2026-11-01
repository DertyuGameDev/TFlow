import fcntl
import logging
import signal
import time
from pathlib import Path
from django.conf import settings
from django.core.management.base import BaseCommand
from django.db import close_old_connections
from flow.push import deliver_due
from flow.reminders import send_due_reminders


class Command(BaseCommand):
    help = 'Persistent reminders and Web Push delivery with bounded retries.'

    def handle(self, *args, **options):
        root=Path(settings.NOTIFICATION_WORKER_ROOT);root.mkdir(parents=True,exist_ok=True,mode=0o700)
        lock=(root/'worker.lock').open('a')
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        stop=False
        def shutdown(*_):
            nonlocal stop
            stop=True
        signal.signal(signal.SIGTERM,shutdown);signal.signal(signal.SIGINT,shutdown)
        last_reminders=0
        try:
            while not stop:
                close_old_connections()
                try:
                    if time.monotonic()-last_reminders>30:
                        send_due_reminders();last_reminders=time.monotonic()
                    (root/'worker').touch(mode=0o600)
                    count=deliver_due()
                except Exception:
                    # Credentials and push endpoints are never included in the log.
                    logging.getLogger('flow.notifications').error('notification_worker_cycle_failed')
                    count=0
                time.sleep(.2 if count else 2)
        finally:
            (root/'worker').unlink(missing_ok=True);lock.close();close_old_connections()
