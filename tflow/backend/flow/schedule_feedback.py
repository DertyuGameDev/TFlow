"""Explain schedule conflicts without exposing participant identities."""
from datetime import timedelta
from zoneinfo import ZoneInfo
from .models import Activity, Registration, Room

MSK = ZoneInfo("Europe/Moscow")

def stamp(value):
    return value.astimezone(MSK).strftime("%d.%m.%Y %H:%M")


def interval(start, end):
    return f"{stamp(start)}–{stamp(end)}"


def short(value, limit=220):
    value = " ".join(str(value or "").split())
    return value[:limit] + ("…" if len(value) > limit else "") or "не указано"


def snapshot(activity):
    return {"starts_at": activity.starts_at, "ends_at": activity.ends_at,
            "room_name": activity.room.name, "capacity": activity.capacity, "title": activity.title,
            "speaker": activity.speaker, "description": activity.description, "registration_required": activity.registration_required}


def change_message(activity, before):
    changes = []
    if (before['starts_at'], before['ends_at']) != (activity.starts_at, activity.ends_at):
        changes.append(f"Время: {interval(before['starts_at'], before['ends_at'])} → {interval(activity.starts_at, activity.ends_at)} МСК")
    if before['room_name'] != activity.room.name:
        changes.append(f"Аудитория: {before['room_name']} → {activity.room.name}")
    if before['capacity'] != activity.capacity:
        changes.append(f"Лимит мест: {before['capacity']} → {activity.capacity}")
    if before['title'] != activity.title:
        changes.append(f"Название: {before['title']} → {activity.title}")
    for key, label in [("speaker", "Спикер"), ("description", "Описание")]:
        if before[key] != getattr(activity, key):
            changes.append(f"{label}: {short(before[key])} → {short(getattr(activity, key))}")
    if before["registration_required"] != activity.registration_required:
        changes.append("Запись: " + ("теперь нужна отдельная регистрация" if activity.registration_required else "доступно всем участникам события без отдельной записи"))
    return f"Обновлена активность «{activity.title}», мероприятие «{activity.event.title}». " + (". ".join(changes) if changes else "Обновлены сведения об активности.")


def conflict_error(activity, code, message):
    from .contracts import FlowError
    duration = activity.ends_at - activity.starts_at
    users = Registration.objects.filter(activity_id=activity.pk).values('user_id')
    other_registrations = Registration.objects.filter(user_id__in=users).exclude(activity_id=activity.pk)
    room_busy = list(Activity.objects.filter(room=activity.room, starts_at__lt=activity.ends_at, ends_at__gt=activity.starts_at).exclude(pk=activity.pk))
    clashes = other_registrations.filter(activity__starts_at__lt=activity.ends_at, activity__ends_at__gt=activity.starts_at)
    affected = clashes.values('user_id').distinct().count()
    # Only reveal names of activities owned by this organizer; conflicts can span events.
    names = list(dict.fromkeys([a.title for a in room_busy] + list(clashes.filter(activity__event__owner=activity.event.owner).values_list('activity__title', flat=True))))[:5]
    occupied = list(other_registrations.values_list('activity__starts_at', 'activity__ends_at').distinct())
    rooms = list(Room.objects.filter(event=activity.event, capacity__gte=activity.capacity, is_online=activity.room.is_online).order_by('id')[:30])
    room_intervals = {r.pk: list(Activity.objects.filter(room=r).exclude(pk=activity.pk).values_list('starts_at','ends_at')) for r in rooms}
    # Exact boundary candidates avoid minute-by-minute scans across multi-day events.
    candidates = sorted(set([activity.starts_at, activity.event.starts_at] + [end for _, end in occupied] + [end for intervals in room_intervals.values() for _, end in intervals]))
    suggestions = []
    for start in candidates:
        end = start + duration
        if start < activity.event.starts_at or end > activity.event.ends_at or any(a < end and b > start for a,b in occupied):
            continue
        for room in rooms:
            if not any(a < end and b > start for a,b in room_intervals[room.pk]):
                suggestions.append(f"{stamp(start)}–{end.astimezone(MSK):%H:%M} МСК, {room.name}")
                break
        if len(suggestions) == 3:
            break
    details = [message]
    if names: details.append("Пересечение: " + ", ".join(names) + ".")
    if affected: details.append(f"Затронуто участников: {affected}.")
    details.append("Подходящие варианты: " + "; ".join(suggestions) + "." if suggestions else "Не удалось подобрать вариант в проверенных аудиториях: выберите другую аудиторию или расширьте даты события.")
    return FlowError(code, " ".join(details), 409)


def event_snapshot(event):
    return {key: getattr(event, key) for key in ['starts_at','ends_at','venue','address','city','title','description','format','capacity','required_profile_fields']}


def event_change_message(event, before, moved=False):
    changes = []
    if before['starts_at'] != event.starts_at or before['ends_at'] != event.ends_at:
        changes.append(f"Время: {interval(before['starts_at'], before['ends_at'])} → {interval(event.starts_at, event.ends_at)} МСК")
    old_place = ', '.join(filter(None, [before['city'],before['venue'],before['address']]))
    new_place = ', '.join(filter(None, [event.city,event.venue,event.address]))
    if old_place != new_place: changes.append(f"Место: {old_place} → {new_place}")
    for key, label in [("title", "Название"), ("description", "Описание"), ("format", "Формат"), ("capacity", "Лимит мест")]:
        if before[key] != getattr(event, key):
            changes.append(f"{label}: {short(before[key])} → {short(getattr(event, key))}")
    if before["required_profile_fields"] != event.required_profile_fields:
        from .profile_data import PROFILE_LABELS
        changes.append("Данные при записи: " + (", ".join(PROFILE_LABELS[k] for k in event.required_profile_fields) or "только имя и почта"))
    return (f"Мероприятие «{event.title}» перенесено. " if moved else f"Обновлено мероприятие «{event.title}». ") + ('. '.join(changes) if changes else 'Обновлены сведения о мероприятии.')
