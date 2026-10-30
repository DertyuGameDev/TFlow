import json
from datetime import timedelta
from pathlib import Path
from django.utils import timezone
from .models import Activity, Community, Event, Room
from .services import require_organizer, schedule_write


def initialize_demo(user):
    require_organizer(user)
    source = json.loads(Path(__file__).with_name("demo_data.json").read_text())
    base = (timezone.now() + timedelta(days=7)).replace(hour=6, minute=0, second=0, microsecond=0)
    with schedule_write():
        for fields in source["communities"]:
            Community.objects.get_or_create(id=fields["id"], defaults={k: v for k, v in fields.items() if k != "id"})
        for index, fields in enumerate(source["events"]):
            if Event.objects.filter(pk=fields["id"]).exists():
                continue
            start = base + timedelta(days=index)
            event = Event.objects.create(
                id=fields["id"], owner=user, title=fields["title"], description=fields["description"],
                topic=fields["topic"], kind=fields["kind"], city=fields["city"], venue=fields["venue"],
                address=fields["address"], format=fields["format"], cover=fields["cover"],
                community_id=fields["community"], starts_at=start,
                ends_at=start + timedelta(hours=32 if fields["kind"] == "Хакатон" else 9), status="published",
            )
            for number in range(2):
                Room.objects.create(id=f"{event.id}-room{number}", event=event,
                                    name="Практическая лаборатория" if number else "Главный зал", capacity=20 if number else 80)
            for number, title in enumerate(fields["activities"]):
                Activity.objects.create(
                    id=f"{event.id}-a{number}", event=event, room_id=f"{event.id}-room{1 if number == 1 else 0}",
                    title=title, description="Практическая сессия с экспертом. Разберём примеры, ответим на вопросы и обсудим ваши задачи.",
                    speaker=["Анна Миронова", "Александр Волков", "Мария Соколова"][number],
                    starts_at=start + timedelta(hours=4 if number == 2 else number),
                    ends_at=start + timedelta(hours=5 if number == 2 else number + 2), capacity=20 if number == 1 else 80,
                )
