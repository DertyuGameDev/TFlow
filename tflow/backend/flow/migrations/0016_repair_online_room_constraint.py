from django.db import migrations


def ensure_online_room_constraint(apps, schema_editor):
    # Earlier local databases applied the two 0014 branches in parallel. The
    # SQLite table rebuild for capacity changes could remove the unique index.
    Room = apps.get_model("flow", "Room")
    name = "one_online_room_per_event"
    with schema_editor.connection.cursor() as cursor:
        constraints = schema_editor.connection.introspection.get_constraints(
            cursor, Room._meta.db_table
        )
    if name not in constraints:
        constraint = next(item for item in Room._meta.constraints if item.name == name)
        schema_editor.add_constraint(Room, constraint)


class Migration(migrations.Migration):
    dependencies = [("flow", "0015_merge_online_rooms_and_form_limits")]
    operations = [
        migrations.RunPython(ensure_online_room_constraint, migrations.RunPython.noop)
    ]
