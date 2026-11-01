import { useMemo, useState, type ReactNode } from "react";
import { ArrowLeftRight, Pencil, Search } from "lucide-react";
import type { Activity } from "../../lib/types";
import { dateKey, dateLabel, timeLabel } from "../../lib/time";
import { FlowSchedule, useFlowClock } from "./flow-schedule";

export function OrganizerFlow({
  activities,
  editor,
  onEdit,
  onSwap,
}: {
  activities: Activity[];
  editor?: { item: Activity; content: ReactNode };
  onEdit: (activity: Activity) => void;
  onSwap: (activity: Activity) => void;
}) {
  const [query, setQuery] = useState(""),
    [room, setRoom] = useState(""),
    [day, setDay] = useState("");
  const now = useFlowClock(activities);
  const rooms = [
    ...new Map(activities.map((a) => [a.room_id, a.room_name])).entries(),
  ];
  const days = [...new Set(activities.map((a) => dateKey(a.starts_at)))].sort();
  const items = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("ru");
    const filtered = activities.filter(
      (a) =>
        a.id !== editor?.item.id &&
        (!needle ||
          `${a.title} ${a.room_name} ${a.speaker}`
            .toLocaleLowerCase("ru")
            .includes(needle)) &&
        (!room || a.room_id === room) &&
        (!day || dateKey(a.starts_at) === day),
    );
    return editor ? [...filtered, editor.item] : filtered;
  }, [activities, editor?.item, query, room, day]);
  return (
    <section className="organizer-flow" aria-label="Флоу организатора">
      {activities.length > 0 && (
        <div className="program-tools flow-organizer-tools">
          <label className="small-search">
            <Search size={17} aria-hidden="true" />
            <input
              aria-label="Найти пункт программы"
              placeholder="Название, аудитория или спикер"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          {rooms.length > 1 && (
            <label className="program-select">
              Аудитория
              <select value={room} onChange={(e) => setRoom(e.target.value)}>
                <option value="">Все аудитории</option>
                {rooms.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {days.length > 1 && (
            <label className="program-select">
              День
              <select value={day} onChange={(e) => setDay(e.target.value)}>
                <option value="">Все дни</option>
                {days.map((value) => (
                  <option key={value} value={value}>
                    {dateLabel(Date.parse(`${value}T12:00:00+03:00`))}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}
      <FlowSchedule
        activities={items}
        now={now}
        selectedId={editor?.item.id}
        onEdit={onEdit}
        renderActivity={(a) =>
          editor?.item.id === a.id ? (
            editor.content
          ) : (
            <article className="flow-organizer-card">
              <div className="flow-organizer-copy">
                <p>
                  {timeLabel(a.starts_at)}–{timeLabel(a.ends_at)} · МСК
                </p>
                <h4>{a.title}</h4>
                <p>
                  {a.room_name}
                  {a.speaker ? ` · ${a.speaker}` : ""}
                </p>
                {a.description && <p>{a.description}</p>}
                <small>
                  {a.taken} записались · {Math.max(0, a.capacity - a.taken)}{" "}
                  мест свободно
                </small>
              </div>
              <div className="flow-organizer-actions">
                <button
                  className="button secondary small-button"
                  aria-label={`Изменить пункт программы ${a.title}`}
                  onClick={() => onEdit(a)}
                >
                  <Pencil size={16} />
                  Изменить
                </button>
                {activities.length > 1 && (
                  <button
                    className="button secondary small-button"
                    aria-label={`Поменять местами ${a.title}`}
                    onClick={() => onSwap(a)}
                  >
                    <ArrowLeftRight size={16} />
                    Поменять местами
                  </button>
                )}
              </div>
            </article>
          )
        }
      />
      {!items.length && (
        <div className="program-no-results">
          <p>
            {activities.length
              ? "По этим фильтрам пунктов нет"
              : "Добавьте первый пункт — он появится на линии времени."}
          </p>
          {activities.length > 0 && (
            <button
              className="text-button"
              onClick={() => {
                setQuery("");
                setRoom("");
                setDay("");
              }}
            >
              Сбросить фильтры
            </button>
          )}
        </div>
      )}
    </section>
  );
}
