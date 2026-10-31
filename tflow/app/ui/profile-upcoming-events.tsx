import { useId } from "react";
import { ArrowUpRight, CalendarDays, MapPin, Plus, Video } from "lucide-react";
import type { FlowEvent } from "../../lib/types";
import { dateLabel, timeLabel } from "../../lib/time";
import "../profile-upcoming.css";

export function ProfileUpcomingEvents({
  events,
  organizerId,
  onCreate,
  now = Date.now(),
}: {
  events: FlowEvent[];
  organizerId: string;
  onCreate: () => void;
  now?: number;
}) {
  const titleId = useId();
  const upcoming = events
    .filter((event) => event.owner_id === organizerId && event.ends_at > now)
    .sort((a, b) => a.starts_at - b.starts_at || a.id.localeCompare(b.id));
  const preview = upcoming.slice(0, 4);
  return (
    <aside className="profile-upcoming" aria-labelledby={titleId}>
      <header className="profile-upcoming-heading">
        <CalendarDays size={21} aria-hidden="true" />
        <h2 id={titleId}>Ближайшие мероприятия</h2>
      </header>
      <p className="profile-upcoming-hint">
        {upcoming.length > preview.length
          ? `Ближайшие ${preview.length} из ${upcoming.length} · время по МСК`
          : "Время по МСК"}
      </p>
      {preview.length ? (
        <>
          <ol className="profile-upcoming-list">
            {preview.map((event) => (
              <li key={event.id}>
                <a
                  className="profile-upcoming-event"
                  href={`#manage/${event.id}`}
                  aria-label={`Управлять мероприятием «${event.title}»`}
                >
                  {(event.status === "draft" || event.starts_at <= now) && (
                    <span
                      className={`profile-upcoming-status ${event.status === "draft" ? "is-draft" : "is-live"}`}
                    >
                      {event.status === "draft" ? "Черновик" : "Идёт сейчас"}
                    </span>
                  )}
                  <div className="profile-upcoming-title">
                    <h3>{event.title}</h3>
                    <ArrowUpRight size={17} aria-hidden="true" />
                  </div>
                  <time dateTime={new Date(event.starts_at).toISOString()}>
                    {dateLabel(event.starts_at, { year: "numeric" })} ·{" "}
                    {timeLabel(event.starts_at)}
                  </time>
                  <span className="profile-upcoming-place">
                    {event.format === "Онлайн" ? (
                      <Video size={14} aria-hidden="true" />
                    ) : (
                      <MapPin size={14} aria-hidden="true" />
                    )}
                    {event.format === "Онлайн"
                      ? "Онлайн"
                      : `${event.city}${event.format === "Гибрид" ? " · Гибрид" : ""}`}
                  </span>
                </a>
              </li>
            ))}
          </ol>
          <a className="text-button profile-upcoming-all" href="#organizer">
            Все мои мероприятия <ArrowUpRight size={16} aria-hidden="true" />
          </a>
        </>
      ) : (
        <div className="profile-upcoming-empty">
          <p>
            Пока нет предстоящих мероприятий. Здесь появятся ваши ближайшие
            встречи.
          </p>
          <button className="button secondary" onClick={onCreate}>
            <Plus size={17} aria-hidden="true" /> Создать событие
          </button>
        </div>
      )}
    </aside>
  );
}
