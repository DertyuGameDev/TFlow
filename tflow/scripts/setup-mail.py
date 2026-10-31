"""Configure the existing Yandex SMTP transport without putting secrets in chat."""

import argparse
import getpass
import os
from pathlib import Path
import re
import smtplib
import ssl
import sys
import tempfile
from urllib.parse import urlsplit

DEFAULT_SENDER = "support.tflow@yandex.ru"
MAIL_FILE = Path(__file__).resolve().parents[1] / "backend" / ".env.mail"


def save_config(path, sender, password, app_url):
    # A quoted dotenv value must not gain a second line or escape its quotes.
    if any(char in password for char in '\r\n\x00"\\'):
        raise ValueError(
            "Пароль содержит недопустимые символы. Создайте новый пароль приложения."
        )
    values = {
        "EMAIL_HOST": "smtp.yandex.ru",
        "EMAIL_PORT": "465",
        "EMAIL_USE_SSL": "1",
        "EMAIL_USE_TLS": "0",
        "EMAIL_HOST_USER": sender,
        "EMAIL_HOST_PASSWORD": password,
        "DEFAULT_FROM_EMAIL": f"ТФлоу <{sender}>",
        "NOTIFICATION_EMAIL_ENABLED": "1",
        "TFLOW_PUBLIC_URL": app_url,
    }
    descriptor, temporary = tempfile.mkstemp(prefix=".env.mail-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            for key, value in values.items():
                stream.write(f'{key}="{value}"\n')
        # mkstemp creates a private file; replace atomically after it is complete.
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Безопасная настройка уведомлений через Яндекс.Почту."
    )
    parser.add_argument(
        "--sender", default=DEFAULT_SENDER, help="Адрес существующего ящика Яндекса"
    )
    parser.add_argument(
        "--url", default="http://localhost:5173", help="Адрес сайта в письмах"
    )
    parser.add_argument(
        "--replace",
        action="store_true",
        help="Заменить существующий локальный файл настроек",
    )
    options = parser.parse_args(argv)
    sender = options.sender.strip().lower()
    if not re.fullmatch(r"[a-z0-9][a-z0-9._+-]*@(yandex\.(ru|com)|ya\.ru)", sender):
        parser.error("Укажите полный адрес Яндекса, например support.tflow@yandex.ru.")
    url = options.url.rstrip("/")
    try:
        parsed = urlsplit(url)
    except ValueError:
        parser.error("--url должен содержать корректный адрес сайта.")
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
        or any(char in url for char in '\r\n\x00"\\')
    ):
        parser.error(
            "--url должен содержать адрес сайта без логина, пароля, параметров и #."
        )
    if MAIL_FILE.exists() and not options.replace:
        parser.error(
            "backend/.env.mail уже существует. Для замены запустите команду с --replace."
        )
    if not sys.stdin.isatty():
        parser.error(
            "Запустите команду в терминале: пароль вводится скрыто, без записи в историю."
        )
    print(f"Отправитель: {sender}")
    print(
        "Сначала создайте ящик, разрешите почтовые приложения и создайте пароль для Почты:"
    )
    print("https://id.yandex.ru/security/app-passwords")
    print(
        "Здесь проверяется только вход в SMTP. Письма из очереди отправляться не будут."
    )
    try:
        password = getpass.getpass("Пароль приложения Яндекса (ввод скрыт): ").strip()
        if not password:
            print("Пароль не введён. Настройки не изменены.", file=sys.stderr)
            return 1
        if any(char in password for char in '\r\n\x00"\\'):
            raise ValueError(
                "Создайте новый пароль приложения без кавычек и переносов строк."
            )
        with smtplib.SMTP_SSL(
            "smtp.yandex.ru", 465, timeout=10, context=ssl.create_default_context()
        ) as connection:
            connection.login(sender, password)
        save_config(MAIL_FILE, sender, password, url)
    except smtplib.SMTPAuthenticationError:
        print(
            "Яндекс отклонил вход. Проверьте пароль приложения и разрешение почтовых программ. Настройки не изменены.",
            file=sys.stderr,
        )
        return 1
    except (OSError, smtplib.SMTPException, ValueError):
        # Provider responses can contain private data; never print their text.
        print(
            "Не удалось проверить или сохранить подключение. Проверьте доступ к Яндексу и настройки ящика. Пароль не записан в вывод.",
            file=sys.stderr,
        )
        return 1
    except (KeyboardInterrupt, EOFError):
        print("\nНастройка прервана.", file=sys.stderr)
        return 1
    print("Вход проверен. Настройки сохранены в backend/.env.mail и исключены из Git.")
    print(
        "Перезапустите npm run dev — обработчик начнёт отправлять накопленные уведомления."
    )
    print(
        "Для опубликованного сайта нужны переменные окружения и отдельный обработчик очереди; локальная настройка их не меняет."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
