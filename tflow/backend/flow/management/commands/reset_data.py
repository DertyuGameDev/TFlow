from django.core.management import BaseCommand, CommandError, call_command
from flow.models import ScheduleLock


class Command(BaseCommand):
    help = "Delete all application data and sessions, retaining schema and the schedule lock."

    def add_arguments(self, parser):
        parser.add_argument(
            "--yes",
            action="store_true",
            help="Confirm deletion of all data in the configured database",
        )

    def handle(self, *args, **options):
        if not options["yes"]:
            raise CommandError("Pass --yes to delete all application data")
        call_command("flush", interactive=False, verbosity=0)
        ScheduleLock.objects.get_or_create(pk=1)
        self.stdout.write(
            self.style.SUCCESS(
                "Application data cleared; schema and schedule lock retained."
            )
        )
