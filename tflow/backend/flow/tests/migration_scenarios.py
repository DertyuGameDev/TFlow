"""Isolated process for exercising both published schema histories."""
import json
from datetime import timedelta
import os
from pathlib import Path
import sys
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
os.environ.pop('DATABASE_URL', None)
os.environ['TFLOW_DATABASE_PATH'] = sys.argv[2]
os.environ['DJANGO_SETTINGS_MODULE'] = 'config.settings'
import django
django.setup()
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.utils import timezone

BASE = [('flow', '0021_merge_attendance_auth')]
MAIN = [('flow', '0031_remove_eventaccesskey_one_active_flow_access_key_and_more')]
FINAL = [('flow', '0032_merge_gosha_webinars')]
scenario = sys.argv[1]
executor = MigrationExecutor(connection)
if scenario == 'gosha':
    executor.migrate(BASE)
    from flow.tests.fixtures.gosha_webinar_migration import Migration
    state = executor.loader.project_state(BASE)
    state = executor.apply_migration(state, Migration('0022_webinar_updates', 'flow'))
    apps = state.apps
elif scenario == 'main':
    executor.migrate(MAIN)
    apps = executor.loader.project_state(MAIN).apps
elif scenario == 'fresh':
    executor.migrate(FINAL)
    apps = executor.loader.project_state(FINAL).apps
else:
    raise ValueError('Unknown migration scenario')

now = timezone.now()
def model(name): return apps.get_model('flow', name)
owner = model('User').objects.create(email='host@migration.test', name='', role='organizer', password='!', pass_token=uuid.uuid4())
viewer = model('User').objects.create(email='viewer@migration.test', name='', password='!', pass_token=uuid.uuid4())
event = model('Event').objects.create(owner=owner, title='Keep event', description='Keep description',
    starts_at=now, ends_at=now+timedelta(hours=2), city='Онлайн', venue='ТФлоу', format='Онлайн', topic='Разработка', kind='Вебинар')
room = model('Room').objects.create(event=event, name='Keep room', capacity=10, is_online=True)
activity = model('Activity').objects.create(event=event, room=room, title='Keep activity', starts_at=now,
    ends_at=event.ends_at, capacity=10, registration_required=False)
for link in (False, True):
    model('EventAccessKey').objects.create(event=event, activity=activity, created_by=owner,
        purpose='webinar', token_hash=('a' if link else 'b')*64, is_link=link, expires_at=event.ends_at)
model('ActivityAttendance').objects.create(user=viewer, activity=activity, source='webinar')
model('CheckIn').objects.create(user=viewer, event=event, source='qr', checked_by=owner)
broadcast = model('HttpBroadcast').objects.create(event=event, activity=activity, active=False,
    publisher_user=owner, publisher_hash='keep-publisher-proof', media_epoch=3, received_seq=8)
model('BroadcastMessage').objects.create(broadcast=broadcast, session=broadcast.session, author=viewer, text='Keep chat')
model('Notification').objects.create(user=viewer, event=event, message='Keep notification')
fields = {
    'User':['id','email','name','password','pass_token','role'],
    'Event':['id','owner_id','title','description','starts_at','ends_at'],
    'Room':['id','event_id','name','capacity','is_online'],
    'Activity':['id','room_id','title','starts_at','ends_at','registration_required'],
    'EventAccessKey':['id','token_hash','is_link','created_by_id','activity_id'],
    'ActivityAttendance':['id','user_id','activity_id','source'],
    'CheckIn':['id','user_id','event_id','checked_by_id','source'],
    'HttpBroadcast':['id','session','publisher_user_id','publisher_hash','media_epoch','received_seq'],
    'BroadcastMessage':['id','broadcast_id','session','author_id','text'],
    'Notification':['id','user_id','event_id','message'],
}
def snapshot(registry):
    return {name:list(registry.get_model('flow',name).objects.order_by('pk').values_list(*columns)) for name,columns in fields.items()}
before = snapshot(apps)
executor = MigrationExecutor(connection)
executor.migrate(FINAL)
final_apps = executor.loader.project_state(FINAL).apps
assert snapshot(final_apps) == before, 'Migration changed existing rows'
with connection.cursor() as cursor:
    cursor.execute('PRAGMA foreign_key_check')
    assert cursor.fetchall() == []
    cursor.execute('PRAGMA integrity_check')
    assert cursor.fetchone()[0] == 'ok'
    constraints = connection.introspection.get_constraints(cursor,'flow_eventaccesskey')
    assert constraints['one_active_flow_access_key']['columns'] == ['activity_id','is_link']
    columns = {column.name for column in connection.introspection.get_table_description(cursor,'flow_checkin')}
    assert 'access_key_id' in columns
assert not MigrationExecutor(connection).migration_plan(FINAL)
print(json.dumps({'scenario':scenario,'data_preserved':True,'schema_valid':True,'idempotent':True}))
