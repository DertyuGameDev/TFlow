"""HTTP registration load check in a temporary SQLite DB; never uses the app DB."""
import json
import os
from pathlib import Path
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from io import StringIO

project = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='tflow-load-') as directory:
    os.environ.update(DJANGO_SETTINGS_MODULE='config.settings', TFLOW_DATABASE_PATH=str(Path(directory)/'load.sqlite3'),
                      NOTIFICATION_EMAIL_ENABLED='0', DJANGO_DEBUG='1', DJANGO_ALLOWED_HOSTS='testserver')
    os.environ.pop('DATABASE_URL',None)
    sys.path.insert(0,str(project/'backend'))
    import django
    django.setup()
    from django.core.management import call_command
    from django.db import connections, close_old_connections
    from django.test import Client
    from django.utils import timezone
    from flow.models import User, Event, Room, Activity, Registration
    call_command('migrate',interactive=False,verbosity=0,stdout=StringIO())
    owner=User.objects.create_user('host@load.example.test',None,role='organizer')
    now=timezone.now()+timedelta(days=1)
    event=Event.objects.create(owner=owner,title='Load test',description='',starts_at=now,ends_at=now+timedelta(hours=3),city='',venue='',format='Очно',topic='',kind='',status='published')
    users=User.objects.bulk_create([User(email=f'{i}@load.example.test') for i in range(200)])
    rooms=Room.objects.bulk_create([Room(event=event,name=f'Hall {i}',capacity=5) for i in range(40)])
    activities=Activity.objects.bulk_create([Activity(event=event,room=room,title=room.name,starts_at=now,ends_at=now+timedelta(hours=1),capacity=5) for room in rooms])
    clients=[]
    for user in users:
        client=Client();client.force_login(user);clients.append(client)
    reports=[]
    for phase in ['same_last_places','independent_activities']:
        Registration.objects.all().delete()
        def attempt(index):
            close_old_connections()
            try:
                activity=activities[0 if phase=='same_last_places' else index//5]
                started=time.monotonic()
                response=clients[index].post(f'/api/activities/{activity.pk}/registration',data={},content_type='application/json')
                return response.status_code,time.monotonic()-started
            finally:connections.close_all()
        started=time.monotonic()
        with ThreadPoolExecutor(max_workers=20) as pool:results=list(pool.map(attempt,range(200)))
        seconds=time.monotonic()-started
        registered=Registration.objects.count()
        expected=5 if phase=='same_last_places' else 200
        assert registered==expected,(phase,registered,results)
        assert all(status in {200,201,409} for status,_ in results),results
        latencies=sorted(elapsed for _,elapsed in results)
        reports.append({'scenario':phase,'requests':200,'workers':20,'activities':40,'registrations':registered,'seconds':round(seconds,3),'p95_seconds':round(latencies[189],3),'backend':'SQLite','service_errors':sum(status>=500 for status,_ in results)})
    print(json.dumps(reports,indent=2))
