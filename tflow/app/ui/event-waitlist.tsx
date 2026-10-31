import { ArrowRight, Clock3, LogOut } from "lucide-react";
import type { FlowEvent, Profile } from "../../lib/types";
import { dateLabel, timeLabel } from "../../lib/time";
import "../event-waitlist.css";

export function EventRegistrationAction({ event, profile, pending, onRegister, onJoin, onLeave }: {
  event: FlowEvent; profile: Profile | null; pending: boolean;
  onRegister: () => void; onJoin: () => void; onLeave: () => void;
}) {
  const closed = event.status !== "published" || event.ends_at <= Date.now();
  if (event.event_waitlisted) {
    const missing = event.required_profile_fields.some((key) => !profile?.[key]);
    return <div className="event-waitlist-state" role="status" aria-label="Вы в листе ожидания мероприятия">
      <Clock3 size={24} aria-hidden="true" />
      <strong>Вы в листе ожидания</strong>
      <span>Место в очереди: {event.event_waitlist_position}</span>
      <p>{closed ? "Событие завершилось. Новые места больше не распределяются." : missing
        ? "Дополните данные анкеты, чтобы получить освободившееся место. Позиция в очереди сохранена."
        : "Когда место освободится, зарегистрируем вас автоматически и пришлём уведомление."}</p>
      {!closed && missing && <button className="button primary" disabled={pending} onClick={onJoin}>Дополнить данные</button>}
      <button className="button secondary" disabled={pending} onClick={onLeave}><LogOut size={17} />Выйти из листа ожидания</button>
    </div>;
  }
  const queue = event.participant_count >= event.capacity || event.event_waiting_count > 0;
  return <button className="button primary register-event" disabled={pending || closed} onClick={queue ? onJoin : onRegister}>
    {pending ? "Сохраняем…" : closed ? "Событие завершено" : queue ? "Встать в лист ожидания" : "Зарегистрироваться"}
    {queue ? <Clock3 size={18} /> : <ArrowRight size={18} />}
  </button>;
}

export function EventWaitlists({ events, pending, onLeave }: {
  events: FlowEvent[]; pending: boolean; onLeave: (event: FlowEvent) => void;
}) {
  const queued = events.filter((event) => event.event_waitlisted && !event.enrolled);
  if (!queued.length) return null;
  return <section className="event-waitlists" aria-label="Лист ожидания мероприятий">
    <h2>Лист ожидания мероприятий</h2>
    <p>Место в очереди не является регистрацией. Когда появится место, событие добавится в календарь.</p>
    <ul>{queued.map((event) => <li key={event.id}>
      <div>
        <a href={`#event/${event.id}`}>{event.title}</a>
        <span>{dateLabel(event.starts_at)} · {timeLabel(event.starts_at)} МСК</span>
        <span>{event.ends_at <= Date.now() ? "Событие завершено" : `Место в очереди: ${event.event_waitlist_position}`}</span>
      </div>
      <button className="text-button" disabled={pending} onClick={() => onLeave(event)} aria-label={`Выйти из листа ожидания: ${event.title}`}>Выйти из очереди</button>
    </li>)}</ul>
  </section>;
}
