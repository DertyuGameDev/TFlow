from importlib.metadata import PackageNotFoundError
from io import StringIO
import json
import sqlite3
from unittest.mock import patch

from django.core.management import CommandError, call_command
from django.db import OperationalError, connection
from django.test import RequestFactory, SimpleTestCase, TestCase, override_settings

from flow.views import api

COMMAND = "flow.management.commands.check_local_runtime"


class DatabaseErrorResponseTests(SimpleTestCase):
    def response(self, error):
        with patch("flow.views.dispatch_api", side_effect=error), self.assertLogs("flow", level="ERROR"):
            return api(RequestFactory().get("/api/bootstrap"), "bootstrap")

    def test_real_sqlite_lock_still_has_a_retryable_busy_response(self):
        cause = sqlite3.OperationalError("private SQL")
        cause.sqlite_errorcode = sqlite3.SQLITE_BUSY | (2 << 8)
        error = OperationalError("private details")
        error.__cause__ = cause
        response = self.response(error)
        self.assertEqual(response.status_code, 503)
        self.assertEqual(json.loads(response.content)["code"], "DATABASE_BUSY")
        self.assertEqual(response["Retry-After"], "3")
        self.assertNotIn(b"private", response.content)

    @override_settings(DEBUG=True)
    def test_missing_sqlite_schema_explains_local_repair_without_leaking_sql(self):
        for detail in ["no such table: private_table", "no such column: private_column", "table secret has no column named private"]:
            with self.subTest(detail=detail):
                response = self.response(OperationalError(detail))
                payload = json.loads(response.content)
                self.assertEqual(payload["code"], "DATABASE_NOT_READY")
                self.assertIn("npm run db:migrate", payload["error"])
                self.assertNotIn(b"private", response.content)
                self.assertIn("no-store", response["Cache-Control"])

    @override_settings(DEBUG=False)
    def test_postgres_missing_schema_is_generic_in_production(self):
        class MissingColumn(Exception):
            sqlstate = "42703"

        error = OperationalError("private SQL")
        error.__cause__ = MissingColumn("private column")
        response = self.response(error)
        self.assertEqual(json.loads(response.content)["code"], "DATABASE_NOT_READY")
        self.assertNotIn(b"migrate", response.content)
        self.assertNotIn(b"private", response.content)

    def test_connection_failure_does_not_pretend_to_be_a_lock(self):
        response = self.response(OperationalError("private credentials"))
        self.assertEqual(json.loads(response.content)["code"], "DATABASE_UNAVAILABLE")
        self.assertNotIn("Retry-After", response)
        self.assertNotIn(b"private", response.content)


class LocalRuntimeCheckTests(TestCase):
    def test_current_environment_and_schema_pass_without_writes(self):
        output = StringIO()
        with connection.execute_wrapper(self.reject_writes):
            call_command("check_local_runtime", stdout=output)
        self.assertIn("OK", output.getvalue())

    @staticmethod
    def reject_writes(execute, sql, params, many, context):
        first = sql.strip().split()[0].upper()
        if first in {"INSERT", "UPDATE", "DELETE", "ALTER", "CREATE", "DROP", "REPLACE"}:
            raise AssertionError("Readiness check attempted to mutate the database")
        return execute(sql, params, many, context)

    def test_missing_dependency_fails_before_reading_the_database(self):
        with patch(f"{COMMAND}.version", side_effect=PackageNotFoundError), patch(f"{COMMAND}.MigrationExecutor") as migrations:
            with self.assertRaisesMessage(CommandError, "не установлен"):
                call_command("check_local_runtime", stdout=StringIO())
        migrations.assert_not_called()

    def test_pending_migrations_cannot_report_a_ready_runtime(self):
        with patch(f"{COMMAND}.MigrationExecutor") as migrations:
            migrations.return_value.migration_plan.return_value = [object()]
            with self.assertRaisesMessage(CommandError, "npm run db:migrate"):
                call_command("check_local_runtime", stdout=StringIO())

    def test_missing_column_is_detected_even_if_migration_history_is_current(self):
        original = connection.introspection.get_table_description

        def description(cursor, table):
            columns = original(cursor, table)
            return [column for column in columns if column.name != "title"] if table == "flow_notification" else columns

        with patch.object(connection.introspection, "get_table_description", side_effect=description):
            with self.assertRaisesMessage(CommandError, "flow_notification.title"):
                call_command("check_local_runtime", stdout=StringIO())

    @override_settings(HTTP_BROADCAST_ENABLED=True)
    def test_https_mode_checks_that_ffmpeg_is_available(self):
        with patch(f"{COMMAND}.shutil.which", return_value=None):
            with self.assertRaisesMessage(CommandError, "FFmpeg"):
                call_command("check_local_runtime", stdout=StringIO())
