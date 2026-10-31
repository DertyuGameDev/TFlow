import { useId, useState } from "react";
import { ChevronDown, ChevronUp, Clock3, MapPin, Video } from "lucide-react";
import type { Activity } from "../../lib/types";
import { dateLabel, timeLabel } from "../../lib/time";
import "../catalog-activities.css";

const PREVIEW_COUNT = 3;

export function CatalogActivities({ activities }: { activities: Activity[] }) {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const items = [...activities].sort(
    (a, b) => a.starts_at - b.starts_at || a.title.localeCompare(b.title, "ru"),
  );
  const visible = expanded ? items : items.slice(0, PREVIEW_COUNT);

  if (!items.length) return null;

  return (
    <section className="catalog-activities" aria-label="Расписание активностей">
      <h3>Расписание активностей <span>{items.length}</span></h3>
      <ul id={listId}>
        {visible.map((activity) => (
          <li key={activity.id}>
            <a href={`#event/${activity.event_id}`}>{activity.title}</a>
            <span className="catalog-activity-time">
              <Clock3 size={13} aria-hidden="true" />
              {dateLabel(activity.starts_at)} · {timeLabel(activity.starts_at)}–{timeLabel(activity.ends_at)} · МСК
            </span>
            <span className="catalog-activity-place">
              {activity.room_is_online
                ? <Video size={13} aria-hidden="true" />
                : <MapPin size={13} aria-hidden="true" />}
              {activity.room_is_online ? `Онлайн · ${activity.room_name}` : activity.room_name}
            </span>
            {activity.speaker && <span>{activity.speaker}</span>}
            {!!activity.registered && <span className="catalog-activity-status">{activity.registration_required === false ? "В вашем расписании" : "Вы записаны"}</span>}
            {!!activity.waitlisted && <span className="catalog-activity-status">Вы в очереди · № {activity.waitlist_position}</span>}
          </li>
        ))}
      </ul>
      {items.length > PREVIEW_COUNT && (
        <button
          className="text-button catalog-activities-toggle"
          type="button"
          aria-expanded={expanded}
          aria-controls={listId}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "Свернуть активности" : `Все активности (${items.length})`}
          {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </button>
      )}
    </section>
  );
}
