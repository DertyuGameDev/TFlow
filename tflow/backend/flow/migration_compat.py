"""Adopt the published gosha webinar schema while retaining canonical main state.

Guards apply only to a database carrying the old branch migration marker. Other
schema conflicts still raise normally. Existing rows and publisher sessions are
never replaced or copied by these operations.
"""
from django.db import migrations
from django.db.migrations.recorder import MigrationRecorder

LEGACY_WEBINARS = ("flow", "0022_webinar_updates")


def legacy_database(connection):
    return LEGACY_WEBINARS in MigrationRecorder(connection).applied_migrations()


def columns(connection, table):
    with connection.cursor() as cursor:
        if table not in connection.introspection.table_names(cursor):
            return None
        return {column.name for column in connection.introspection.get_table_description(cursor, table)}


class AdoptWebinarModel(migrations.CreateModel):
    def database_forwards(self, app_label, schema_editor, from_state, to_state):
        connection = schema_editor.connection
        model = to_state.apps.get_model(app_label, self.name)
        existing = columns(connection, model._meta.db_table) if legacy_database(connection) else None
        if existing is not None:
            expected = {field.column for field in model._meta.local_fields}
            if not expected <= existing:
                raise RuntimeError(f"Incomplete legacy webinar table: {model._meta.db_table}")
            return
        super().database_forwards(app_label, schema_editor, from_state, to_state)


class AdoptWebinarField(migrations.AddField):
    def database_forwards(self, app_label, schema_editor, from_state, to_state):
        connection = schema_editor.connection
        model = to_state.apps.get_model(app_label, self.model_name)
        if legacy_database(connection):
            existing = columns(connection, model._meta.db_table)
            if existing is not None and model._meta.get_field(self.name).column in existing:
                return
        super().database_forwards(app_label, schema_editor, from_state, to_state)


class AdoptWebinarConstraint(migrations.AddConstraint):
    def database_forwards(self, app_label, schema_editor, from_state, to_state):
        connection = schema_editor.connection
        model = to_state.apps.get_model(app_label, self.model_name)
        if legacy_database(connection):
            with connection.cursor() as cursor:
                constraints = connection.introspection.get_constraints(cursor, model._meta.db_table)
            if self.constraint.name in constraints:
                return
        super().database_forwards(app_label, schema_editor, from_state, to_state)
