import uuid
from django.db import migrations, models


def backfill(apps, schema_editor):
    User = apps.get_model("flow", "User")
    Event = apps.get_model("flow", "Event")
    Registration = apps.get_model("flow", "Registration")
    Enrollment = apps.get_model("flow", "EventRegistration")
    alias = schema_editor.connection.alias
    for user in User.objects.using(alias).filter(pass_token__isnull=True).iterator():
        user.pass_token = uuid.uuid4()
        user.save(using=alias, update_fields=["pass_token"])
    owners = Event.objects.using(alias).values_list("owner_id", flat=True)
    User.objects.using(alias).filter(pk__in=owners).update(role="organizer")
    for registration in (
        Registration.objects.using(alias).select_related("activity").iterator()
    ):
        Enrollment.objects.using(alias).get_or_create(
            user_id=registration.user_id,
            event_id=registration.activity.event_id,
            defaults={"created_at": registration.created_at},
        )


class Migration(migrations.Migration):
    dependencies = [("flow", "0003_checkin_eventregistration_event_capacity_and_more")]
    operations = [
        migrations.RunPython(backfill, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="user",
            name="pass_token",
            field=models.UUIDField(default=uuid.uuid4, unique=True, editable=False),
        ),
    ]
