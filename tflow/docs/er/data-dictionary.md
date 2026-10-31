# Словарь данных ТФлоу

Сгенерировано из текущих Django-моделей; версия схемы: flow.0028. Все скалярные поля доменных моделей перечислены ниже. PK - первичный ключ, FK - внешний ключ, UQ - уникальность одного поля, NULL - допустимо отсутствие значения. Пустая строка и NULL различаются.

## User - Пользователь

Таблица: `flow_user`.

| Колонка | Тип | Ограничения / связь |
|---|---|---|
| `password` | CharField | max_length=128 |
| `last_login` | DateTimeField | NULL |
| `is_superuser` | BooleanField |  |
| `is_staff` | BooleanField |  |
| `is_active` | BooleanField |  |
| `date_joined` | DateTimeField |  |
| `id` | CharField | PK; max_length=100 |
| `email` | CharField | UQ; max_length=254 |
| `first_name` | TextField |  |
| `last_name` | TextField |  |
| `name` | TextField |  |
| `city` | TextField |  |
| `phone` | TextField |  |
| `birth_date` | DateField | NULL |
| `telegram` | TextField |  |
| `organization` | TextField |  |
| `job_title` | TextField |  |
| `education` | TextField |  |
| `website` | TextField |  |
| `about` | TextField |  |
| `interests` | TextField |  |
| `role` | CharField | max_length=16 |
| `pass_token` | UUIDField | UQ; max_length=32 |

- `user_valid_role`: `<CheckConstraint: condition=(AND: ('role__in', ['participant', 'organizer'])) name='user_valid_role'>`
- Наследуемая M:N `groups` → `auth.Group`; промежуточная таблица `flow_user_groups`.
- Наследуемая M:N `user_permissions` → `auth.Permission`; промежуточная таблица `flow_user_user_permissions`.

## AuthRateLimit - Лимиты попыток входа

Таблица: `flow_authratelimit`.

| Колонка | Тип | Ограничения / связь |
|---|---|---|
| `key` | CharField | PK; max_length=64 |
| `attempts` | PositiveIntegerField |  |
| `expires_at` | DateTimeField |  |


## ScheduleLock - Блокировка расписания

Таблица: `flow_schedulelock`.

| Колонка | Тип | Ограничения / связь |
|---|---|---|
| `id` | PositiveSmallIntegerField | PK |


## UserAvatar - Фото пользователя

Таблица: `flow_useravatar`.

| Колонка | Тип | Ограничения / связь |
|---|---|---|
| `id` | BigAutoField | PK |
| `user_id` | OneToOneField | UQ; FK → flow_user.id; CASCADE |
| `image` | BinaryField |  |
| `updated_at` | DateTimeField |  |


## Community - Клуб

Таблица: `flow_community`.

| Колонка | Тип | Ограничения / связь |
|---|---|---|
| `id` | CharField | PK; max_length=100 |
| `name` | TextField |  |
| `description` | TextField |  |
| `topic` | TextField |  |
| `color` | CharField | max_length=30 |
| `owner_id` | ForeignKey | NULL; FK → flow_user.id; SET_NULL |


## CommunityAvatar - Фото клуба

Таблица: `flow_communityavatar`.

| Колонка | Тип | Ограничения / связь |
|---|---|---|
| `id` | BigAutoField | PK |
| `community_id` | OneToOneField | UQ; FK → flow_community.id; CASCADE |
| `image` | BinaryField |  |
| `updated_at` | DateTimeField |  |


## Event - Мероприятие

Таблица: `flow_event`.

| Колонка | Тип | Ограничения / связь |
|---|---|---|
| `id` | CharField | PK; max_length=100 |
| `owner_id` | ForeignKey | FK → flow_user.id; PROTECT |
| `title` | TextField |  |
| `description` | TextField |  |
| `starts_at` | DateTimeField |  |
| `ends_at` | DateTimeField |  |
| `city` | TextField |  |
| `venue` | TextField |  |
| `address` | TextField |  |
| `format` | CharField | max_length=10 |
| `topic` | TextField |  |
| `kind` | TextField |  |
| `cover` | CharField | max_length=20 |
| `status` | CharField | max_length=10 |
| `community_id` | ForeignKey | NULL; FK → flow_community.id; SET_NULL |
| `updated_at` | DateTimeField |  |
| `capacity` | PositiveBigIntegerField |  |
| `required_profile_fields` | JSONField |  |

- `event_positive_duration`: `<CheckConstraint: condition=(AND: ('ends_at__gt', F(starts_at))) name='event_positive_duration'>`
- `event_valid_capacity`: `<CheckConstraint: condition=(AND: ('capacity__gte', 1)) name='event_valid_capacity'>`

## Webinar - Комната видеосвязи

Таблица: `flow_webinar`.

| Колонка | Тип | Ограничения / связь |
|---|---|---|
| `id` | BigAutoField | PK |
| `event_id` | ForeignKey | FK → flow_event.id; CASCADE |
| `activity_id` | OneToOneField | UQ; NULL; FK → flow_activity.id; CASCADE |
| `room` | UUIDField | UQ; max_length=32 |
| `active` | BooleanField |  |
| `started_at` | DateTimeField | NULL |
| `ended_at` | DateTimeField | NULL |

- `one_general_webinar_per_event`: `<UniqueConstraint: fields=('event',) name='one_general_webinar_per_event' condition=(AND: ('activity__isnull', True))>`

## Room - Аудитория

Таблица: `flow_room`.

| Колонка | Тип | Ограничения / связь |
|---|---|---|
| `id` | CharField | PK; max_length=100 |
| `event_id` | ForeignKey | FK → flow_event.id; CASCADE |
| `name` | TextField |  |
| `capacity` | PositiveBigIntegerField |  |
| `is_online` | BooleanField |  |

- `room_valid_capacity`: `<CheckConstraint: condition=(AND: ('capacity__gte', 1)) name='room_valid_capacity'>`

## Activity - Флоу / активность

Таблица: `flow_activity`.

| Колонка | Тип | Ограничения / связь |
|---|---|---|
| `id` | CharField | PK; max_length=100 |
| `event_id` | ForeignKey | FK → flow_event.id; CASCADE |
| `room_id` | ForeignKey | FK → flow_room.id; PROTECT |
| `title` | TextField |  |
| `description` | TextField |  |
| `speaker` | TextField |  |
| `starts_at` | DateTimeField |  |
| `ends_at` | DateTimeField |  |
| `capacity` | PositiveBigIntegerField |  |
| `registration_required` | BooleanField |  |
| `updated_at` | DateTimeField |  |

- `activity_positive_duration`: `<CheckConstraint: condition=(AND: ('ends_at__gt', F(starts_at))) name='activity_positive_duration'>`
- `activity_valid_capacity`: `<CheckConstraint: condition=(AND: ('capacity__gte', 1)) name='activity_valid_capacity'>`
- Индекс: `['room', 'starts_at', 'ends_at']`.

## Registration - Запись на флоу

Таблица: `flow_registration`.

| Колонка | Тип | Ограничения / связь |
|---|---|---|
| `id` | BigAutoField | PK |
| `user_id` | ForeignKey | FK → flow_user.id; CASCADE |
| `activity_id` | ForeignKey | FK → flow_activity.id; CASCADE |
| `created_at` | DateTimeField |  |

- `unique_registration`: `<UniqueConstraint: fields=('user', 'activity') name='unique_registration'>`

## WaitlistEntry - Очередь на флоу

Таблица: `flow_waitlistentry`.

| Колонка | Тип | Ограничения / связь |
|---|---|---|
| `id` | BigAutoField | PK |
| `user_id` | ForeignKey | FK → flow_user.id; CASCADE |
| `activity_id` | ForeignKey | FK → flow_activity.id; CASCADE |
| `created_at` | DateTimeField |  |

- `unique_waitlist_entry`: `<UniqueConstraint: fields=('user', 'activity') name='unique_waitlist_entry'>`
- Индекс: `['activity', 'id']`.

## EventRegistration - Билет мероприятия

Таблица: `flow_eventregistration`.

| Колонка | Тип | Ограничения / связь |
|---|---|---|
| `id` | BigAutoField | PK |
| `user_id` | ForeignKey | FK → flow_user.id; CASCADE |
| `event_id` | ForeignKey | FK → flow_event.id; CASCADE |
| `created_at` | DateTimeField |  |
| `profile_data` | JSONField |  |

- `unique_event_registration`: `<UniqueConstraint: fields=('user', 'event') name='unique_event_registration'>`

## EventWaitlistEntry - Очередь мероприятия

Таблица: `flow_eventwaitlistentry`.

| Колонка | Тип | Ограничения / связь |
|---|---|---|
| `id` | BigAutoField | PK |
| `user_id` | ForeignKey | FK → flow_user.id; CASCADE |
| `event_id` | ForeignKey | FK → flow_event.id; CASCADE |
| `created_at` | DateTimeField |  |

- `unique_event_waitlist_entry`: `<UniqueConstraint: fields=('user', 'event') name='unique_event_waitlist_entry'>`
- Индекс: `['event', 'id']`.

## CheckIn - Вход на мероприятие

Таблица: `flow_checkin`.

| Колонка | Тип | Ограничения / связь |
|---|---|---|
| `id` | BigAutoField | PK |
| `user_id` | ForeignKey | FK → flow_user.id; CASCADE |
| `event_id` | ForeignKey | FK → flow_event.id; CASCADE |
| `checked_by_id` | ForeignKey | NULL; FK → flow_user.id; PROTECT |
| `source` | CharField | max_length=12 |
| `created_at` | DateTimeField |  |
| `access_key_id` | ForeignKey | NULL; FK → flow_eventaccesskey.id; SET_NULL |

- `unique_event_check_in`: `<UniqueConstraint: fields=('user', 'event') name='unique_event_check_in'>`
- `check_in_source_verifier`: `<CheckConstraint: condition=(OR: (AND: ('checked_by__isnull', False), ('source', 'qr')), (AND: ('checked_by__isnull', True), ('source', 'webinar'))) name='check_in_source_verifier'>`

## EventAccessKey - Ключ помощника / ведущего

Таблица: `flow_eventaccesskey`.

| Колонка | Тип | Ограничения / связь |
|---|---|---|
| `id` | CharField | PK; max_length=100 |
| `event_id` | ForeignKey | FK → flow_event.id; CASCADE |
| `activity_id` | ForeignKey | NULL; FK → flow_activity.id; CASCADE |
| `created_by_id` | ForeignKey | NULL; FK → flow_user.id; SET_NULL |
| `token_hash` | CharField | UQ; max_length=64 |
| `purpose` | CharField | max_length=16 |
| `created_at` | DateTimeField |  |
| `expires_at` | DateTimeField |  |
| `revoked_at` | DateTimeField | NULL |

- `one_active_event_scan_key`: `<UniqueConstraint: fields=('event',) name='one_active_event_scan_key' condition=(AND: ('activity__isnull', True), ('revoked_at__isnull', True))>`
- `one_active_flow_access_key`: `<UniqueConstraint: fields=('activity',) name='one_active_flow_access_key' condition=(AND: ('activity__isnull', False), ('revoked_at__isnull', True))>`
- `valid_access_key_scope`: `<CheckConstraint: condition=(OR: (AND: ('activity__isnull', True), ('purpose', 'scan')), (AND: ('activity__isnull', False), ('purpose', 'webinar'))) name='valid_access_key_scope'>`

## EventAccessUse - Использование ключа

Таблица: `flow_eventaccessuse`.

| Колонка | Тип | Ограничения / связь |
|---|---|---|
| `id` | BigAutoField | PK |
| `key_id` | ForeignKey | FK → flow_eventaccesskey.id; CASCADE |
| `user_id` | ForeignKey | FK → flow_user.id; CASCADE |
| `last_used_at` | DateTimeField |  |

- `unique_access_key_user`: `<UniqueConstraint: fields=('key', 'user') name='unique_access_key_user'>`

## Bookmark - Избранное

Таблица: `flow_bookmark`.

| Колонка | Тип | Ограничения / связь |
|---|---|---|
| `id` | BigAutoField | PK |
| `user_id` | ForeignKey | FK → flow_user.id; CASCADE |
| `event_id` | ForeignKey | FK → flow_event.id; CASCADE |

- `unique_bookmark`: `<UniqueConstraint: fields=('user', 'event') name='unique_bookmark'>`

## Membership - Участие и подписка в клубе

Таблица: `flow_membership`.

| Колонка | Тип | Ограничения / связь |
|---|---|---|
| `id` | BigAutoField | PK |
| `notify_events` | BooleanField |  |
| `user_id` | ForeignKey | FK → flow_user.id; CASCADE |
| `community_id` | ForeignKey | FK → flow_community.id; CASCADE |

- `unique_membership`: `<UniqueConstraint: fields=('user', 'community') name='unique_membership'>`

## Notification - Уведомление на сайте

Таблица: `flow_notification`.

| Колонка | Тип | Ограничения / связь |
|---|---|---|
| `activity_id` | ForeignKey | NULL; FK → flow_activity.id; SET_NULL |
| `id` | CharField | PK; max_length=100 |
| `user_id` | ForeignKey | FK → flow_user.id; CASCADE |
| `event_id` | ForeignKey | NULL; FK → flow_event.id; SET_NULL |
| `kind` | CharField | max_length=24 |
| `message` | TextField | max_length=1000 |
| `created_at` | DateTimeField |  |
| `read` | BooleanField |  |


## ActivityAttendance - Посещение флоу

Таблица: `flow_activityattendance`.

| Колонка | Тип | Ограничения / связь |
|---|---|---|
| `id` | BigAutoField | PK |
| `user_id` | ForeignKey | FK → flow_user.id; CASCADE |
| `activity_id` | ForeignKey | FK → flow_activity.id; CASCADE |
| `checked_by_id` | ForeignKey | NULL; FK → flow_user.id; PROTECT |
| `access_key_id` | ForeignKey | NULL; FK → flow_eventaccesskey.id; SET_NULL |
| `source` | CharField | max_length=12 |
| `created_at` | DateTimeField |  |

- `unique_activity_attendance`: `<UniqueConstraint: fields=('user', 'activity') name='unique_activity_attendance'>`
- `activity_attendance_verifier`: `<CheckConstraint: condition=(OR: (AND: ('checked_by__isnull', False), ('source', 'qr')), (AND: ('checked_by__isnull', True), ('source', 'webinar'))) name='activity_attendance_verifier'>`

## ActivityReminder - Защита от повторных напоминаний

Таблица: `flow_activityreminder`.

| Колонка | Тип | Ограничения / связь |
|---|---|---|
| `id` | BigAutoField | PK |
| `user_id` | ForeignKey | FK → flow_user.id; CASCADE |
| `activity_id` | ForeignKey | FK → flow_activity.id; CASCADE |
| `starts_at` | DateTimeField |  |

- `unique_activity_reminder`: `<UniqueConstraint: fields=('user', 'activity', 'starts_at') name='unique_activity_reminder'>`

## Что вне доменных листов

Стандартные таблицы Django auth_group, auth_permission, django_content_type, django_session и django_migrations обслуживают авторизацию, сессии и миграции. Унаследованные группы и permissions пользователя не заменяют бизнес-роль User.role. Автоматические M:N пользователя перечислены выше; они не являются регистрациями участников.

CHECK и UNIQUE перечислены по метаданным ORM. Согласованность Activity.event и Room.event, календарные конфликты, вместимость относительно занятых мест, право организатора и принадлежность флоу ключу дополнительно проверяет приложение; отдельный FK не гарантирует этих правил.
