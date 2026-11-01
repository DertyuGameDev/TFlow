"""Additive and repeatable local judging dataset. Never creates production accounts."""

from datetime import timedelta
from zoneinfo import ZoneInfo

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import connection, transaction
from django.utils import timezone

from flow.jury_demo import ALIASES
from flow.models import (
    Activity,
    ActivityAttendance,
    Bookmark,
    CheckIn,
    Community,
    Event,
    EventRegistration,
    EventWaitlistEntry,
    Membership,
    Notification,
    Registration,
    Room,
    User,
    WaitlistEntry,
)
from flow.profile_data import participant_profile

TOPICS = [
    (
        "Открытая студия: нейросети в работе",
        "Искусственный интеллект",
        "Онлайн",
        "Москва",
        "Как применять нейросети в повседневных задачах: от идеи до рабочего прототипа.",
    ),
    (
        "Дизайн понятных интерфейсов",
        "Дизайн",
        "Очно",
        "Москва",
        "Разбираем сценарии пользователей, собираем прототип и обсуждаем доступность интерфейсов.",
    ),
    (
        "Запусти свой первый продукт",
        "Предпринимательство",
        "Гибрид",
        "Санкт-Петербург",
        "Проверка идеи, первые пользователи и экономика небольшого проекта.",
    ),
    (
        "Город в объективе",
        "Фотография",
        "Очно",
        "Мурманск",
        "Практика городской фотографии: свет, композиция и истории людей.",
    ),
    (
        "Карьера: портфолио и собеседования",
        "Карьера",
        "Онлайн",
        "Казань",
        "Собираем убедительное портфолио и тренируем рассказ о своих проектах.",
    ),
    (
        "Наука рядом: от вопроса к эксперименту",
        "Наука и образование",
        "Очно",
        "Москва",
        "Проверяем гипотезы, планируем простой эксперимент и обсуждаем результаты.",
    ),
    (
        "Зелёный город: делаем вместе",
        "Экология",
        "Очно",
        "Мурманск",
        "Локальные экологические инициативы и мастерская проектов для своего района.",
    ),
    (
        "Музыкальная лаборатория",
        "Музыка",
        "Гибрид",
        "Санкт-Петербург",
        "Слушаем, импровизируем и создаём собственный короткий музыкальный проект.",
    ),
    (
        "Движение и энергия",
        "Спорт и фитнес",
        "Очно",
        "Казань",
        "Встреча о безопасной физической активности и привычках для хорошего самочувствия.",
    ),
    (
        "Python: от скрипта к приложению",
        "Разработка",
        "Очно",
        "Москва",
        "Практический интенсив: API, данные и сборка небольшого работающего приложения.",
    ),
]


class Command(BaseCommand):
    help = "Create 10 local jury participants, organizer, events, programs and demo scenarios."

    @transaction.atomic
    def handle(self, *args, **options):
        if not settings.DEBUG or settings.IS_VERCEL or connection.vendor != "sqlite":
            raise CommandError(
                "Jury fixtures are permitted only on a local DEBUG SQLite database"
            )
        users = []
        for index, alias in enumerate([*map(str, range(1, 11)), "test"], 1):
            pk = f"jury-user-{index:02}"
            role = "organizer" if alias == "test" else "participant"
            name = "Тестовый организатор" if alias == "test" else f"Участник {alias}"
            user, created = User.objects.get_or_create(
                email=ALIASES[alias],
                defaults={
                    "id": pk,
                    "role": role,
                    "name": name,
                    "first_name": "Тестовый" if alias == "test" else "Участник",
                    "last_name": "организатор" if alias == "test" else alias,
                    "city": ["Москва", "Санкт-Петербург", "Мурманск", "Казань"][
                        (index - 1) % 4
                    ],
                    "organization": "Команда жюри" if index > 3 else "",
                    "phone": f"+7 000 000-00-{index:02}" if index > 3 else "",
                    "job_title": "Эксперт" if index > 4 else "",
                    "interests": ", ".join(
                        [TOPICS[(index - 1) % 10][1], TOPICS[index % 10][1]]
                    ),
                    "about": "Демонстрационный профиль для проверки ТФлоу."
                    if index > 3
                    else "",
                },
            )
            if not created and (
                user.pk != pk
                or user.role != role
                or not user.is_active
                or not user.check_password(alias)
            ):
                raise CommandError(
                    f"An existing account conflicts with reserved jury identity {pk}; nothing changed"
                )
            if created:
                user.set_password(alias)
                user.save()
            users.append(user)
        owner = users[-1]
        people = users[:-1]
        clubs = []
        for index, (name, topic, color) in enumerate(
            [
                ("Технологии и продукты", "Искусственный интеллект", "yellow"),
                ("Креативная мастерская", "Дизайн", "blue"),
                ("Люди и карьера", "Карьера", "green"),
                ("Город и открытия", "Наука и образование", "purple"),
            ],
            1,
        ):
            club, created = Community.objects.get_or_create(
                id=f"jury-club-{index}",
                defaults={
                    "owner": owner,
                    "name": name,
                    "topic": topic,
                    "color": color,
                    "description": "Демонстрационное сообщество для общения, событий и совместных проектов.",
                },
            )
            if club.owner_id != owner.pk:
                raise CommandError("Reserved jury club belongs to another owner")
            clubs.append(club)
            Membership.objects.get_or_create(user=owner, community=club)
        for index, user in enumerate(people):
            for offset in [0, 1]:
                Membership.objects.get_or_create(
                    user=user, community=clubs[(index + offset) % len(clubs)]
                )
        now = (
            timezone.now()
            .astimezone(ZoneInfo("Europe/Moscow"))
            .replace(second=0, microsecond=0)
        )
        morning = now.replace(hour=10, minute=0)
        events = []
        program = []
        for index, (title, topic, format, city, description) in enumerate(TOPICS):
            start = (
                now - timedelta(hours=1)
                if index == 0
                else morning + timedelta(days=-1 if index == 8 else index)
            )
            event, created = Event.objects.get_or_create(
                id=f"jury-event-{index + 1:02}",
                defaults={
                    "owner": owner,
                    "title": title,
                    "description": description + " Демонстрационное событие для жюри.",
                    "starts_at": start,
                    "ends_at": start + timedelta(hours=4),
                    "city": city,
                    "venue": "Онлайн-студия ТФлоу"
                    if format == "Онлайн"
                    else "Городское пространство",
                    "address": "" if format == "Онлайн" else "Центральная улица, 10",
                    "format": format,
                    "topic": topic,
                    "kind": "Практикум" if index % 2 else "Встреча",
                    "cover": ["yellow", "blue", "green", "purple", "orange"][index % 5],
                    "status": "published",
                    "capacity": 3 if index == 9 else 30,
                    "community": clubs[index % len(clubs)],
                    "required_profile_fields": ["phone", "organization"]
                    if index == 1
                    else ["about"]
                    if index == 4
                    else [],
                },
            )
            if event.owner_id != owner.pk:
                raise CommandError("Reserved jury event belongs to another owner")
            rooms = []
            for room_index in range(2):
                online = format == "Онлайн" or (format == "Гибрид" and room_index == 1)
                room, _ = Room.objects.get_or_create(
                    id=f"jury-room-{index + 1:02}-{room_index}",
                    defaults={
                        "event": event,
                        "name": ("Онлайн-комната" if online else "Главный зал")
                        + (" · второй поток" if room_index else ""),
                        "capacity": event.capacity,
                        "is_online": online,
                    },
                )
                if room.event_id != event.pk:
                    raise CommandError("Reserved jury room belongs to another event")
                rooms.append(room)
            activities = []
            for part, (label, speaker) in enumerate(
                [
                    ("Знакомство и разбор темы", "Анна Смирнова"),
                    ("Практическая мастерская", "Михаил Соколов"),
                    ("Обсуждение и вопросы", "Елена Волкова"),
                ]
            ):
                offset = timedelta(hours=0 if index == 2 and part == 1 else part)
                end = (
                    event.starts_at
                    + offset
                    + timedelta(hours=2 if index == 0 and part == 0 else 1)
                )
                if index == 0 and part == 1:
                    offset = timedelta(hours=2)
                    end = event.starts_at + timedelta(hours=3)
                if index == 0 and part == 2:
                    offset = timedelta(hours=3)
                    end = event.ends_at
                room = rooms[1 if part == 1 else 0]
                activity, _ = Activity.objects.get_or_create(
                    id=f"jury-activity-{index + 1:02}-{part + 1}",
                    defaults={
                        "event": event,
                        "room": room,
                        "title": label,
                        "description": description,
                        "speaker": speaker,
                        "starts_at": event.starts_at + offset,
                        "ends_at": end,
                        "capacity": 1 if index == 9 and part == 0 else event.capacity,
                        "registration_required": not (part == 2 or index == 0),
                    },
                )
                if activity.event_id != event.pk:
                    raise CommandError(
                        "Reserved jury activity belongs to another event"
                    )
                activities.append(activity)
            events.append(event)
            program.append(activities)

        def enroll(user, index, activity=False):
            if any(
                not getattr(user, key) for key in events[index].required_profile_fields
            ):
                return
            EventRegistration.objects.get_or_create(
                user=user,
                event=events[index],
                defaults={"profile_data": participant_profile(user)},
            )
            if activity:
                Registration.objects.get_or_create(
                    user=user, activity=program[index][0]
                )

        for index, user in enumerate(people):
            enroll(user, 0, activity=index < 5)
            for event_index in {(index + 2) % 8, (index + 5) % 8}:
                enroll(user, event_index, activity=True)
            for event_index in {(index + 3) % 8, (index + 6) % 8}:
                Bookmark.objects.get_or_create(user=user, event=events[event_index])
            Notification.objects.get_or_create(
                id=f"jury-notice-{index + 1:02}",
                defaults={
                    "user": user,
                    "event": events[0],
                    "title": "Добро пожаловать в ТФлоу",
                    "message": "Тестовый аккаунт готов: в профиле есть личный QR, в календаре — записи на события. Выберите новое мероприятие или проверьте избранное.",
                    "kind": "info",
                },
            )
        for user in people[:3]:
            enroll(user, 9)
        Registration.objects.get_or_create(user=people[0], activity=program[9][0])
        WaitlistEntry.objects.get_or_create(user=people[1], activity=program[9][0])
        for user in people[3:5]:
            EventWaitlistEntry.objects.get_or_create(user=user, event=events[9])
        for user in people[6:]:
            enroll(user, 8, True)
        for user in people[7:]:
            CheckIn.objects.get_or_create(
                user=user,
                event=events[8],
                defaults={
                    "checked_by": owner,
                    "created_at": events[8].starts_at + timedelta(minutes=15),
                },
            )
            ActivityAttendance.objects.get_or_create(
                user=user,
                activity=program[8][0],
                defaults={
                    "checked_by": owner,
                    "created_at": program[8][0].starts_at + timedelta(minutes=20),
                },
            )
        draft, _ = Event.objects.get_or_create(
            id="jury-event-draft",
            defaults={
                "owner": owner,
                "title": "Робототехника: собираем первый прототип",
                "description": "Черновик мероприятия для проверки публикации и составления программы.",
                "starts_at": morning + timedelta(days=12),
                "ends_at": morning + timedelta(days=12, hours=4),
                "city": "Мурманск",
                "venue": "Инженерная мастерская",
                "format": "Очно",
                "topic": "Робототехника",
                "kind": "Практикум",
                "status": "draft",
                "capacity": 20,
            },
        )
        if draft.owner_id != owner.pk:
            raise CommandError("Reserved jury draft belongs to another owner")
        self.stdout.write(
            self.style.SUCCESS(
                "Local jury fixtures ready: 10 participants, 1 organizer, 10 published events, 1 draft, 30 activities, 4 clubs."
            )
        )
