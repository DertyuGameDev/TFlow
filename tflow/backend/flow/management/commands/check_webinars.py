from django.core.management.base import BaseCommand, CommandError
from flow.contracts import FlowError
from flow.webinars import configuration_error, room_api


class Command(BaseCommand):
    help = "Проверяет конфигурацию и авторизованное соединение с LiveKit без создания комнат."

    def handle(self, *args, **options):
        error = configuration_error()
        if error:
            raise CommandError(error)
        try:
            room_api("ListRooms", "")
        except FlowError as error:
            raise CommandError(error.message) from error
        self.stdout.write(self.style.SUCCESS(
            "LiveKit API доступен, ключи приняты. Публичный WSS и доставку медиа нужно также проверить из браузера."
        ))
