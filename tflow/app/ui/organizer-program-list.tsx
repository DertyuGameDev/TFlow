import { useMemo, useState } from "react";
import { ArrowLeftRight, ChevronLeft, ChevronRight, Pencil, Search } from "lucide-react";
import type { Activity } from "../../lib/types";
import { dateKey, dateLabel, timeLabel } from "../../lib/time";
import "../organizer-program.css";

const PAGE_SIZE = 12;

export function OrganizerProgramList({
  activities,
  editingId,
  onEdit,
  onSwap,
}: {
  activities: Activity[];
  editingId?: string;
  onEdit: (activity: Activity) => void;
  onSwap?: (activity: Activity) => void;
}) {
  const [query, setQuery] = useState(""),
    [page, setPage] = useState(0);
  const items = useMemo(
    () =>
      activities
        .filter((item) =>
          `${item.title} ${item.room_name} ${item.speaker}`
            .toLocaleLowerCase("ru")
            .includes(query.trim().toLocaleLowerCase("ru")),
        )
        .sort((a, b) => a.starts_at - b.starts_at || a.id.localeCompare(b.id)),
    [activities, query],
  );
  const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages - 1);
  const visible = items.slice(
    currentPage * PAGE_SIZE,
    (currentPage + 1) * PAGE_SIZE,
  );
  const groups = new Map<string, Activity[]>();
  for (const item of visible) {
    const key = dateKey(item.starts_at);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return (
    <section
      className="management-program-list"
      aria-label="Список пунктов программы"
    >
      {activities.length > PAGE_SIZE && (
        <label className="small-search management-program-search">
          <Search size={17} />
          <input
            type="search"
            aria-label="Найти пункт программы"
            placeholder="Название, аудитория или спикер"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
          />
        </label>
      )}
      {[...groups].map(([key, entries]) => (
        <section className="management-program-day" key={key}>
          <h3>{dateLabel(entries[0].starts_at, { year: "numeric" })}</h3>
          <ol>
            {entries.map((item) => (
              <li
                className={`management-program-item ${editingId === item.id ? "is-editing" : ""}`}
                key={item.id}
              >
                <div className="management-program-time">
                  <time dateTime={new Date(item.starts_at).toISOString()}>
                    {timeLabel(item.starts_at)}
                  </time>
                  –
                  <time dateTime={new Date(item.ends_at).toISOString()}>
                    {dateKey(item.starts_at) !== dateKey(item.ends_at)
                      ? `${dateLabel(item.ends_at)} `
                      : ""}
                    {timeLabel(item.ends_at)}
                  </time>
                </div>
                <div className="management-program-copy">
                  <h4>{item.title}</h4>
                  <p>
                    {item.room_name}
                    {item.speaker ? ` · ${item.speaker}` : ""}
                  </p>
                  {item.description && (
                    <p className="management-program-description">
                      {item.description}
                    </p>
                  )}
                  <small>
                    {item.taken} занято ·{" "}
                    {Math.max(0, item.capacity - item.taken)} свободно
                    {item.waiting_count
                      ? ` · в очереди: ${item.waiting_count}`
                      : ""}
                  </small>
                </div>
                <div className="management-program-actions">
                <button
                  type="button"
                  className="button secondary small-button management-program-edit"
                  aria-label={`Изменить пункт программы ${item.title}`}
                  onClick={() => onEdit(item)}
                >
                  <Pencil size={16} />
                  Изменить
                </button>
                {onSwap && activities.length > 1 && (
                  <button
                    type="button"
                    className="button secondary small-button"
                    aria-label={`Поменять местами ${item.title}`}
                    onClick={() => onSwap(item)}
                  >
                    <ArrowLeftRight size={16} />
                    Поменять местами
                  </button>
                )}
                </div>
              </li>
            ))}
          </ol>
        </section>
      ))}
      {!items.length && (
        <p className="management-program-empty">
          {query
            ? "По этому запросу ничего не найдено."
            : "Пока нет пунктов программы. Добавьте первый в форме ниже."}
        </p>
      )}
      {pages > 1 && (
        <nav
          className="management-program-pagination"
          aria-label="Страницы программы"
        >
          <button
            type="button"
            className="icon-button"
            aria-label="Предыдущая страница программы"
            disabled={currentPage === 0}
            onClick={() => setPage(currentPage - 1)}
          >
            <ChevronLeft size={18} />
          </button>
          <span>
            {currentPage * PAGE_SIZE + 1}–
            {Math.min((currentPage + 1) * PAGE_SIZE, items.length)} из{" "}
            {items.length}
          </span>
          <button
            type="button"
            className="icon-button"
            aria-label="Следующая страница программы"
            disabled={currentPage === pages - 1}
            onClick={() => setPage(currentPage + 1)}
          >
            <ChevronRight size={18} />
          </button>
        </nav>
      )}
    </section>
  );
}
