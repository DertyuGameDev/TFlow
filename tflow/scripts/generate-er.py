#!/usr/bin/env python3
"""Export domain ER diagrams and data dictionary from Django model metadata."""
import html
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
import django
django.setup()
from django.apps import apps

OUT = ROOT / 'docs' / 'er'
OUT.mkdir(exist_ok=True)
MODELS = {model.__name__: model for model in apps.get_app_config('flow').get_models()}
NAMES = {
 'User':'Пользователь', 'Community':'Клуб', 'Event':'Мероприятие', 'Room':'Аудитория',
 'Activity':'Флоу / активность', 'Registration':'Запись на флоу', 'EventRegistration':'Билет мероприятия',
 'WaitlistEntry':'Очередь на флоу', 'EventWaitlistEntry':'Очередь мероприятия',
 'CheckIn':'Вход на мероприятие', 'ActivityAttendance':'Посещение флоу', 'Webinar':'Комната видеосвязи',
 'EventAccessKey':'Ключ помощника / ведущего', 'EventAccessUse':'Использование ключа',
 'Membership':'Участие и подписка в клубе', 'Bookmark':'Избранное', 'Notification':'Уведомление на сайте',
 'ActivityReminder':'Защита от повторных напоминаний', 'UserAvatar':'Фото пользователя',
 'CommunityAvatar':'Фото клуба', 'AuthRateLimit':'Лимиты попыток входа', 'ScheduleLock':'Блокировка расписания',
}
# Repeated short cards are references to the same table, not additional entities.
GROUPS = [
 ('08-user','Аккаунт и профиль', ['User'], set(), 'Email - логин. role - участник или организатор. Пароль хранится в виде хеша.'),
 ('01-overview','ТФлоу | Как устроены данные',
  ['User','Community','Event','Room','Activity'],
  set(), 'Обзор: ключевые сущности и связи. Все поля и технические таблицы - на следующих листах.'),
 ('02-program','Программа мероприятия', ['User','Community','Event','Room','Activity'],
  {'User','Community'}, 'Event объединяет аудитории и флоу. Activity.room должен принадлежать тому же Event (проверка приложения).'),
 ('03-registration','Билеты, записи и листы ожидания',
  ['User','Event','Activity','EventRegistration','Registration','EventWaitlistEntry','WaitlistEntry'],
  {'User','Event','Activity'}, 'Билет мероприятия, запись на флоу и очередь - разные сущности. Очереди упорядочены по id (FIFO).'),
 ('04-attendance','Посещение и онлайн-комнаты',
  ['User','Event','Activity','EventAccessKey','CheckIn','ActivityAttendance','Webinar'],
  {'User','Event','Activity','EventAccessKey'}, 'Запись не равна посещению. Webinar без activity - общая комната мероприятия; с activity - отдельный онлайн-флоу.'),
 ('05-permissions','Делегирование прав организатора',
  ['User','Event','Activity','EventAccessKey','EventAccessUse'],
  {'User','Event','Activity'}, 'scan: ключ мероприятия без activity. webinar: ключ конкретного флоу. В БД хранится хеш, а не открытый ключ.'),
 ('06-community','Клубы, подписки и избранное',
  ['User','Event','Community','Membership','CommunityAvatar','Bookmark'],
  {'User','Event'}, 'Membership.notify_events управляет уведомлениями о новых событиях клуба. Подписка не создаёт билет мероприятия.'),
 ('07-notifications','Уведомления и служебные данные',
  ['User','Event','Activity','Notification','ActivityReminder','UserAvatar','AuthRateLimit','ScheduleLock'],
  {'User','Event','Activity'}, 'Notification сохраняет сообщение даже после удаления события / флоу. Почтовая очередь удалена миграцией 0028.'),
]

def card(name, short=False, overview=False):
 model=MODELS[name]
 fields=list(model._meta.fields)
 if short:
  fields=[model._meta.pk]
 elif overview:
  fields=[f for f in fields if f.primary_key or f.name in {'title','name','role'}]
 rows=[]
 for f in fields:
  badge='PK' if f.primary_key else 'FK' if f.is_relation else ''
  if f.unique and not f.primary_key: badge+=' UQ'
  if f.null: badge+=' NULL'
  detail=f.related_model.__name__ if f.is_relation else f.get_internal_type().replace('Field','')
  rows.append(f'<TR><TD ALIGN="LEFT" PORT="{f.name}"><FONT COLOR="#8b6a00">{badge or " "}</FONT></TD><TD ALIGN="LEFT">{html.escape(f.column)}</TD><TD ALIGN="LEFT"><FONT COLOR="#657080">{html.escape(detail)}</FONT></TD></TR>')
 suffix=' (ссылка)' if short else ''
 label=f'<TABLE BORDER="0" CELLBORDER="0" CELLSPACING="0" CELLPADDING="7" BGCOLOR="#ffffff"><TR><TD COLSPAN="3" BGCOLOR="#ffdf62"><B>{name}</B></TD></TR><TR><TD COLSPAN="3" ALIGN="LEFT"><FONT COLOR="#4b5563">{NAMES[name]}{suffix}</FONT></TD></TR>'+''.join(rows)+'</TABLE>'
 return f'"{name}" [label=<{label}>];'

for slug,title,names,refs,note in GROUPS:
 overview=slug=='01-overview'
 direction='LR'
 lines=['digraph ER {', f'graph [rankdir={direction}, bgcolor="#f3f5f7", pad="0.5", nodesep="0.55", ranksep="1.15", splines=spline, outputorder=edgesfirst, fontname="DejaVu Sans", fontsize=24, labelloc=t, label='+repr(title).replace("'",'"')+'];', 'node [shape=plain, fontname="DejaVu Sans", fontsize=13];', 'edge [fontname="DejaVu Sans", fontsize=11, color="#7f8b9b", fontcolor="#364152", arrowsize=0.6, arrowhead=none];']
 lines += [card(name,name in refs,overview) for name in names]
 for child in names:
  if child in refs: continue
  for f in MODELS[child]._meta.fields:
   if not f.is_relation or f.related_model.__name__ not in names: continue
   parent=f.related_model.__name__
   # Reference cards contain only their PK. Never invent a hidden-field port.
   left=MODELS[parent]._meta.pk.name
   one='0..1' if f.null else '1'
   many='0..1' if f.unique else '0..N'
   source=f'"{parent}":e'
   target=f'"{child}":w' if overview else f'"{child}":{f.name}:w'
   lines.append(f'{source} -> {target} [label="{f.column}\\n{one} : {many}"];')
 lines += ['}']
 (OUT/f'{slug}.dot').write_text('\n'.join(lines)+'\n')

parts=['# Словарь данных ТФлоу', '', 'Сгенерировано из текущих Django-моделей; версия схемы: flow.0028. Все скалярные поля доменных моделей перечислены ниже. PK - первичный ключ, FK - внешний ключ, UQ - уникальность одного поля, NULL - допустимо отсутствие значения. Пустая строка и NULL различаются.', '']
for name,model in MODELS.items():
 parts += [f'## {name} - {NAMES[name]}', '', f'Таблица: `{model._meta.db_table}`.', '', '| Колонка | Тип | Ограничения / связь |', '|---|---|---|']
 for f in model._meta.fields:
  flags=[]
  if f.primary_key: flags.append('PK')
  elif f.unique: flags.append('UQ')
  if f.null: flags.append('NULL')
  if f.is_relation: flags.append(f'FK → {f.related_model._meta.db_table}.{f.target_field.column}; {f.remote_field.on_delete.__name__}')
  if getattr(f,'max_length',None): flags.append(f'max_length={f.max_length}')
  parts.append(f'| `{f.column}` | {f.get_internal_type()} | {"; ".join(flags)} |')
 parts.append('')
 for constraint in model._meta.constraints:
  parts.append(f'- `{constraint.name}`: `{str(constraint).replace("|"," / ")}`')
 for index in model._meta.indexes: parts.append(f'- Индекс: `{index.fields}`.')
 for f in model._meta.many_to_many: parts.append(f'- Наследуемая M:N `{f.name}` → `{f.related_model._meta.label}`; промежуточная таблица `{f.remote_field.through._meta.db_table}`.')
 parts.append('')
parts += ['## Что вне доменных листов', '', 'Стандартные таблицы Django auth_group, auth_permission, django_content_type, django_session и django_migrations обслуживают авторизацию, сессии и миграции. Унаследованные группы и permissions пользователя не заменяют бизнес-роль User.role. Автоматические M:N пользователя перечислены выше; они не являются регистрациями участников.', '', 'CHECK и UNIQUE перечислены по метаданным ORM. Согласованность Activity.event и Room.event, календарные конфликты, вместимость относительно занятых мест, право организатора и принадлежность флоу ключу дополнительно проверяет приложение; отдельный FK не гарантирует этих правил.']
(OUT/'data-dictionary.md').write_text('\n'.join(parts)+'\n')
covered={name for slug,_,names,refs,_ in GROUPS if slug!='01-overview' for name in names if name not in refs}
assert covered==set(MODELS), f'Missing full cards: {set(MODELS)-covered}'
print(f'Exported {len(GROUPS)} diagrams; {len(MODELS)} domain models covered.')
