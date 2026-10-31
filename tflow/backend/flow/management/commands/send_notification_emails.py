import time
from django.core.management.base import BaseCommand, CommandError
from flow.mailing import send_pending_emails


class Command(BaseCommand):
    help = "Отправляет очередь уведомлений по email; --watch запускает постоянный обработчик."

    def add_arguments(self, parser):
        parser.add_argument("--limit", type=int, default=25)
        parser.add_argument("--watch", action="store_true")

    def handle(self, *args, **options):
        if not 1 <= options["limit"] <= 1000:
            raise CommandError("--limit должен быть от 1 до 1000")
        try:
            while True:
                result = send_pending_emails(options["limit"])
                if not result["configured"]:
                    raise CommandError(
                        "Отправитель не подключён. Настройте EMAIL_HOST_USER, EMAIL_HOST_PASSWORD, DEFAULT_FROM_EMAIL и NOTIFICATION_EMAIL_ENABLED=1. Письма сохранены в очереди."
                    )
                if result["sent"] or result["failed"] or not options["watch"]:
                    self.stdout.write(
                        f"Отправлено: {result['sent']}; осталось для повтора: {result['failed']}"
                    )
                if not options["watch"]:
                    return
                time.sleep(2)
        except KeyboardInterrupt:
            return
