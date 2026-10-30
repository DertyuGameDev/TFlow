"""Portable iCalendar downloads; no external calendar account is required."""
from datetime import timezone
from hashlib import sha256
from django.http import HttpResponse


def text(value):
    return str(value).replace("\\", "\\\\").replace("\r\n", "\n").replace("\r", "\n").replace("\n", "\\n").replace(";", "\\;").replace(",", "\\,")


def utc(value):
    return value.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def fold(line):
    # RFC 5545's 75-octet limit applies to UTF-8 bytes, including continuation space.
    lines, current, size = [], "", 0
    for char in line:
        length = len(char.encode("utf-8"))
        if size + length > 75:
            lines.append(current)
            current, size = " ", 1
        current += char
        size += length
    lines.append(current)
    return "\r\n".join(lines)


def calendar_response(items, *, filename, name):
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//TFlow//EventFlow//RU", "CALSCALE:GREGORIAN",
             "METHOD:PUBLISH", f"X-WR-CALNAME:{text(name)}"]
    for item in items:
        uid = sha256(item["id"].encode("utf-8")).hexdigest()
        lines.extend(["BEGIN:VEVENT", f"UID:{uid}@tflow", f"DTSTAMP:{utc(item['updated_at'])}",
                      f"LAST-MODIFIED:{utc(item['updated_at'])}", f"DTSTART:{utc(item['starts_at'])}",
                      f"DTEND:{utc(item['ends_at'])}", f"SUMMARY:{text(item['title'])}",
                      f"DESCRIPTION:{text(item['description'])}", f"LOCATION:{text(item['location'])}",
                      "BEGIN:VALARM", "TRIGGER:-PT30M", "ACTION:DISPLAY", f"DESCRIPTION:{text(item['title'])}",
                      "END:VALARM", "END:VEVENT"])
    lines.append("END:VCALENDAR")
    return HttpResponse("\r\n".join(fold(line) for line in lines) + "\r\n", content_type="text/calendar; charset=utf-8",
                        headers={"Content-Disposition": f'attachment; filename="{filename}"', "Cache-Control": "private, no-store"})


def event_item(event):
    return {"id": f"event:{event.pk}", "title": event.title, "description": event.description,
            "starts_at": event.starts_at, "ends_at": event.ends_at, "updated_at": event.updated_at,
            "location": " · ".join(filter(None, [event.city, event.venue, event.address]))}


def activity_item(activity):
    return {"id": f"activity:{activity.pk}", "title": activity.title,
            "description": "\n".join(filter(None, [activity.event.title, activity.description, activity.speaker])),
            "starts_at": activity.starts_at, "ends_at": activity.ends_at, "updated_at": activity.updated_at,
            "location": " · ".join(filter(None, [activity.event.city, activity.event.venue, activity.event.address, activity.room.name]))}
