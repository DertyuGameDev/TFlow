import { useId, useState } from "react";
import { AlertCircle, Check, Clock3, MapPin, Search, Users, Video } from "lucide-react";
import type { Activity } from "../../lib/types";
import { dateKey, dateLabel, overlaps, timeLabel } from "../../lib/time";
import { activityAvailability } from "../../lib/activities";
import { webinarPath } from "../../lib/webinars";

export type ActivityAction = "register" | "cancel" | "join" | "leave";
type Actions = { schedule: Activity[]; organizer: boolean; pending: boolean; onAction: (activity: Activity, action: ActivityAction) => void; userId?: string; webinarOwnerId?: string };

export function ActivityCard({ activity: a, schedule, organizer, pending, onAction, personal = false, userId, webinarOwnerId }: Actions & { activity: Activity; personal?: boolean }) {
  const { conflict, closed, free } = activityAvailability(a, schedule, Date.now());
  const open = a.registration_required === false;
  const full = free === 0;
  const operation: ActivityAction = a.registered ? "cancel" : a.waitlisted ? "leave" : full ? "join" : "register";
  const disabled = pending || (!a.registered && !a.waitlisted && (closed || !!conflict));
  return <article className={`program-card ${a.registered ? "program-card-registered" : ""}`}>
    <div className="program-time"><strong>{timeLabel(a.starts_at)}</strong><span>{timeLabel(a.ends_at)}</span></div>
    <div className="program-copy">
      {personal && <a className="program-event" href={`#event/${a.event_id}`}>{a.event_title}</a>}
      <h3>{a.title}</h3>
      <div className="program-meta"><span>{a.room_is_online ? <Video size={14}/> : <MapPin size={14}/>} {a.room_is_online ? `Онлайн · ${a.room_name}` : `${personal && a.venue ? `${a.venue} · ` : ""}${a.room_name}`}</span>{a.speaker && <span>{a.speaker}</span>}</div>
      {a.description && <p>{a.description}</p>}
      <div className="program-badges">
        <span className={`program-badge ${full ? "is-full" : ""}`}><Users size={13}/>{open ? "Без отдельной регистрации" : full ? "Мест нет" : `${free} из ${a.capacity} мест свободно`}</span>
        {!!a.registered && <span className="program-badge is-registered"><Check size={13}/>{open ? "В вашем расписании" : "Вы записаны"}</span>}
        {!!a.waitlisted && <span className="program-badge is-waiting"><Clock3 size={13}/>Вы в очереди · № {a.waitlist_position}</span>}
        {!a.waitlisted && a.waiting_count > 0 && <span className="program-queue-count">В очереди: {a.waiting_count}</span>}
      </div>
      {open && <p className="muted small">Доступна всем участникам мероприятия. Добавление в расписание не бронирует место.</p>}
      {a.room_is_online && userId && a.ends_at > Date.now() && (organizer ? webinarOwnerId === userId : !!a.registered || (open && a.event_enrolled)) &&
        <a className="text-button program-webinar-entry" href={webinarPath(a.event_id, a.id)}
          target={organizer ? "_blank" : undefined} rel={organizer ? "noopener noreferrer" : undefined}
          title={organizer ? "Откроется в новой вкладке" : undefined}>
          <Video size={16}/>{organizer ? "Открыть студию флоу" : "Войти в вебинар флоу"}
        </a>}
      {conflict && !a.registered && <p className="program-conflict"><AlertCircle size={15}/><span>{a.waitlisted ? "Для автоматической записи освободите время: " : "Пересечение с «"}{conflict.title}{a.waitlisted ? ". Ваше место в очереди сохранено." : `» (${timeLabel(conflict.starts_at)}–${timeLabel(conflict.ends_at)}).`}</span></p>}
    </div>
    {!organizer && <button className={`button small-button ${a.registered || a.waitlisted ? "secondary" : "primary"}`} disabled={disabled} onClick={() => onAction(a, operation)}>
      {a.registered ? open ? "Убрать из расписания" : "Отменить запись" : a.waitlisted ? "Покинуть очередь" : closed ? open ? "Уже завершилось" : "Уже началось" : conflict ? "Время занято" : open ? a.event_enrolled ? "В расписание" : "Зарегистрироваться на мероприятие" : full ? "В лист ожидания" : "Записаться"}
    </button>}
  </article>;
}

export function ActivityProgram({ activities, personal = false, ...actions }: Actions & { activities: Activity[]; personal?: boolean }) {
  const [query, setQuery] = useState(""), [room, setRoom] = useState(""), [day, setDay] = useState(""), [available, setAvailable] = useState(false);
  const id = useId();
  const rooms = Array.from(new Map(activities.map(a => [a.room_id, a.room_name])).entries());
  const days = Array.from(new Set(activities.map(a => dateKey(a.starts_at)))).sort();
  const visible = activities.filter(a => (!query || `${a.title} ${a.speaker} ${a.description} ${a.event_title ?? ""}`.toLocaleLowerCase("ru").includes(query.trim().toLocaleLowerCase("ru"))) && (!room || a.room_id === room) && (!day || dateKey(a.starts_at) === day) && (!available || (!a.registered && !activityAvailability(a, actions.schedule, Date.now()).blocked))).sort((a, b) => a.starts_at - b.starts_at || a.title.localeCompare(b.title));
  const groups = new Map<string, Activity[]>();
  for (const a of visible) { const key = dateKey(a.starts_at); groups.set(key, [...(groups.get(key) ?? []), a]); }
  function reset() { setQuery(""); setRoom(""); setDay(""); setAvailable(false); }
  return <div className="activity-program">
    <div className="program-tools">
      <label className="small-search"><Search size={17}/><input aria-label="Найти активность" placeholder="Название или спикер" value={query} onChange={e => setQuery(e.target.value)}/></label>
      <label className="program-select" htmlFor={`${id}-room`}>Аудитория<select id={`${id}-room`} value={room} onChange={e => setRoom(e.target.value)}><option value="">Все аудитории</option>{rooms.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {days.length > 1 && <label className="program-select" htmlFor={`${id}-day`}>День<select id={`${id}-day`} value={day} onChange={e => setDay(e.target.value)}><option value="">Все дни</option>{days.map(value => <option key={value} value={value}>{dateLabel(new Date(`${value}T12:00:00+03:00`).getTime(), {year:"numeric"})}</option>)}</select></label>}
    </div>
    {!personal && !actions.organizer && <label className="program-available"><input type="checkbox" checked={available} onChange={e => setAvailable(e.target.checked)}/>Только свободные места без пересечений</label>}
    <p className="program-results" role="status">Показано: {visible.length} из {activities.length} · время по МСК</p>
    {Array.from(groups.entries()).map(([key, items]) => <section className="program-day" key={key}><h3 className="program-day-label">{dateLabel(items[0].starts_at, {weekday:"long", year:"numeric"})}</h3>{items.map(a => <ActivityCard key={a.id} activity={a} personal={personal} {...actions}/>)}</section>)}
    {!visible.length && <div className="program-no-results"><p>По этим фильтрам активностей нет</p><button className="text-button" onClick={reset}>Сбросить фильтры</button></div>}
  </div>;
}
