"""Retain the published gosha migration marker without duplicating main's state.

The original branch created final webinar tables ahead of main. Canonical main
migrations now describe that schema; their guarded operations adopt existing
branch tables only when this marker is already present. A fresh database follows
main's normal schema operations. The original operations are frozen in the
migration compatibility test fixture.
"""
from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [("flow", "0021_merge_attendance_auth")]
    operations = []
