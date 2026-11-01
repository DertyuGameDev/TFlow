from django.core.management.base import BaseCommand, CommandError
from flow.broadcast_worker import run_worker


class Command(BaseCommand):
    help = "Encode authenticated HTTPS broadcasts with bounded resource usage"

    def handle(self, *args, **options):
        try:
            run_worker()
        except (OSError, RuntimeError) as error:
            raise CommandError(str(error)) from None
