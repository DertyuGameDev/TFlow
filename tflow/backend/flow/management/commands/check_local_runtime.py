"""Read-only readiness checks for the working database and installed packages."""

from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
import shutil

from django.apps import apps
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import DatabaseError, connection
from django.db.migrations.executor import MigrationExecutor


def dependency_issues():
    issues = []
    for line in (settings.BASE_DIR / "requirements.lock.txt").read_text().splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        name, expected = line.strip().split("==", 1)
        try:
            installed = version(name)
        except PackageNotFoundError:
            installed = "не установлен"
        if installed != expected:
            issues.append(f"{name}: {installed}; требуется {expected}")
    return issues


def schema_issues():
    tables = set(connection.introspection.table_names())
    issues = []
    with connection.cursor() as cursor:
        for model in apps.get_models(include_auto_created=True):
            if not model._meta.managed or model._meta.proxy:
                continue
            table = model._meta.db_table
            if table not in tables:
                issues.append(f"нет таблицы {table}")
                continue
            columns = {column.name for column in connection.introspection.get_table_description(cursor, table)}
            missing = {field.column for field in model._meta.local_fields} - columns
            issues.extend(f"нет поля {table}.{column}" for column in sorted(missing))
    return issues


class Command(BaseCommand):
    help = "Проверяет установленные зависимости, миграции и схему рабочей БД без изменения данных."
    requires_system_checks = []

    def handle(self, *args, **options):
        issues = dependency_issues()
        if issues:
            raise CommandError("Установите зависимости из backend/requirements.lock.txt в venv:\n" + "\n".join(issues))
        if connection.vendor == "sqlite":
            name = str(connection.settings_dict["NAME"])
            if name != ":memory:" and not name.startswith("file:") and not Path(name).exists():
                raise CommandError("База не создана. Выполните npm run db:migrate.")
        try:
            executor = MigrationExecutor(connection)
            if executor.migration_plan(executor.loader.graph.leaf_nodes()):
                raise CommandError("Есть неприменённые миграции. Выполните npm run db:migrate.")
            issues = schema_issues()
        except DatabaseError:
            raise CommandError("База данных недоступна. Проверьте подключение и настройки.") from None
        if issues:
            raise CommandError("Схема базы не соответствует коду:\n" + "\n".join(issues))
        if settings.HTTP_BROADCAST_ENABLED and not shutil.which(settings.HTTP_BROADCAST_FFMPEG):
            raise CommandError("Для HTTPS-трансляций не найден FFmpeg. Проверьте TFLOW_FFMPEG.")
        self.stdout.write(self.style.SUCCESS("Зависимости, миграции и схема рабочей базы: OK"))
