import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Layers,
  List,
  Minus,
  Pencil,
  Plus,
  Search,
} from "lucide-react";
import type { Activity, FlowEvent } from "../../lib/types";
import { dateKey, dateLabel, timeLabel } from "../../lib/time";
import {
  buildProgramTracks,
  itemsInRange,
  programColorMap,
  programDayBounds,
  programDayRange,
  segmentBackground,
  shiftProgramDay,
  type TimelineSegment,
} from "../../lib/program-timeline";
import "../program-timeline.css";

const PAGE_SIZE = 8;
const MAX_ZOOM = 64;

export function ProgramTimeline({
  event,
  activities,
  onEdit,
}: {
  event: FlowEvent;
  activities: Activity[];
  onEdit: (activity: Activity) => void;
}) {
  const id = useId();
  const viewport = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  const [chosenDay, setChosenDay] = useState(dateKey(event.starts_at));
  const [roomId, setRoomId] = useState("");
  const [zoom, setZoom] = useState(1);
  const [selectedId, setSelectedId] = useState("");
  const [listOpen, setListOpen] = useState(false);
  const [groupIds, setGroupIds] = useState<string[] | null>(null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const { first, last } = programDayBounds(event.starts_at, event.ends_at);
  const day = chosenDay >= first && chosenDay <= last ? chosenDay : first;
  const { start, end } = programDayRange(day, event.starts_at, event.ends_at);
  const colors = useMemo(() => programColorMap(activities), [activities]);
  const dayItems = useMemo(
    () => itemsInRange(activities, start, end),
    [activities, start, end],
  );
  const rooms = [
    ...new Map(
      dayItems.map((item) => [item.room_id, item.room_name]),
    ).entries(),
  ];
  const room = rooms.some(([key]) => key === roomId) ? roomId : "";
  const items = useMemo(
    () => dayItems.filter((item) => !room || item.room_id === room),
    [dayItems, room],
  );
  const canvasWidth = Math.max(1, width - 32) * zoom;
  const tracks = useMemo(
    () => buildProgramTracks(items, start, end, canvasWidth),
    [items, start, end, canvasWidth],
  );
  const dense = tracks.some((track) =>
    track.segments.some((segment) => segment.items.length > 1),
  );
  const selected = items.find((item) => item.id === selectedId) ?? items[0];
  const selectedIndex = items.findIndex((item) => item.id === selected?.id);
  const group = groupIds ? new Set(groupIds) : null;
  const listItems = items.filter(
    (item) =>
      (!group || group.has(item.id)) &&
      `${item.title} ${item.speaker} ${item.room_name}`
        .toLocaleLowerCase("ru")
        .includes(query.trim().toLocaleLowerCase("ru")),
  );
  const pageCount = Math.max(1, Math.ceil(listItems.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const visibleItems = listItems.slice(
    currentPage * PAGE_SIZE,
    (currentPage + 1) * PAGE_SIZE,
  );

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  function changeDay(value: string) {
    if (!value) return;
    setChosenDay(value);
    setGroupIds(null);
    setQuery("");
    setPage(0);
    viewport.current?.scrollTo({ left: 0, top: 0 });
  }
  function changeZoom(value: number) {
    const next = Math.max(1, Math.min(MAX_ZOOM, value));
    const element = viewport.current;
    const center = element
      ? (element.scrollLeft + width / 2) / Math.max(1, canvasWidth)
      : 0;
    setZoom(next);
    requestAnimationFrame(() => {
      element?.scrollTo({
        left:
          next === 1
            ? 0
            : Math.max(0, center * Math.max(1, width - 32) * next - width / 2),
      });
    });
  }
  function selectItem(item: Activity) {
    setSelectedId(item.id);
    const element = viewport.current;
    if (element && zoom > 1)
      element.scrollTo({
        left: Math.max(
          0,
          ((Math.max(start, item.starts_at) - start) / (end - start)) *
            canvasWidth -
            width / 3,
        ),
      });
  }
  function selectSegment(segment: TimelineSegment) {
    setSelectedId(segment.items[0].id);
    setQuery("");
    setPage(0);
    setGroupIds(
      segment.items.length > 1 ? segment.items.map((item) => item.id) : null,
    );
    if (segment.items.length > 1) setListOpen(true);
  }
  function tickLabel(value: number) {
    return value === end && dateKey(value) !== day ? "24:00" : timeLabel(value);
  }

  return (
    <section className="program-timeline" aria-label="Графическое расписание">
      <div className="timeline-toolbar">
        {first === last ? (
          <h3>{dateLabel(start, { year: "numeric" })}</h3>
        ) : (
          <div className="timeline-day">
            <button
              className="icon-button"
              aria-label="Предыдущий день программы"
              disabled={day === first}
              onClick={() => changeDay(shiftProgramDay(day, -1))}
            >
              <ChevronLeft size={18} />
            </button>
            <label>
              <span className="sr-only">День программы</span>
              <input
                type="date"
                min={first}
                max={last}
                value={day}
                onChange={(e) => changeDay(e.target.value)}
              />
            </label>
            <button
              className="icon-button"
              aria-label="Следующий день программы"
              disabled={day === last}
              onClick={() => changeDay(shiftProgramDay(day, 1))}
            >
              <ChevronRight size={18} />
            </button>
          </div>
        )}
        <div className="timeline-view-controls">
          {rooms.length > 1 && (
            <label className="timeline-room-filter">
              <span className="sr-only">Аудитория на шкале</span>
              <select
                value={room}
                onChange={(e) => {
                  setRoomId(e.target.value);
                  setGroupIds(null);
                  setPage(0);
                }}
              >
                <option value="">Все аудитории</option>
                {rooms.map(([key, name]) => (
                  <option key={key} value={key}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div
            className="timeline-zoom"
            role="group"
            aria-label="Масштаб расписания"
          >
            <button
              aria-label="Уменьшить масштаб расписания"
              disabled={zoom === 1}
              onClick={() => changeZoom(zoom / 2)}
            >
              <Minus size={16} />
            </button>
            <button
              className="timeline-fit"
              onClick={() => changeZoom(1)}
              title="Вместить всё расписание в ширину экрана"
            >
              {zoom === 1 ? "Весь день" : `×${zoom} · Вместить`}
            </button>
            <button
              aria-label="Увеличить масштаб расписания"
              disabled={zoom === MAX_ZOOM}
              onClick={() => changeZoom(zoom * 2)}
            >
              <Plus size={16} />
            </button>
          </div>
        </div>
      </div>
      <p className="timeline-caption" id={`${id}-hint`}>
        Пунктов: {items.length} · время по МСК. Нажмите на цветной отрезок,
        чтобы увидеть детали.
        {dense
          ? " Мелкие пункты объединены в группы с числом — откройте группу или увеличьте масштаб."
          : ""}
        {zoom > 1 ? " Шкалу можно прокручивать по горизонтали." : ""}
      </p>
      <div
        ref={viewport}
        className="timeline-scroll"
        tabIndex={0}
        role="region"
        aria-label="Временная шкала программы"
        aria-describedby={`${id}-hint`}
      >
        <div className="timeline-canvas" style={{ width: canvasWidth }}>
          <div className="timeline-axis" aria-hidden="true">
            {[0, 0.25, 0.5, 0.75, 1].map((fraction, index) => (
              <span
                key={fraction}
                className={`timeline-tick timeline-tick-${index}`}
                style={{ left: `${fraction * 100}%` }}
              >
                {tickLabel(start + (end - start) * fraction)}
              </span>
            ))}
          </div>
          {tracks.map((track) => (
            <div className="timeline-track" key={track.id}>
              <h4>{track.name}</h4>
              <div
                className="timeline-rail"
                role="group"
                aria-label={track.name}
              >
                {track.segments.map((segment) => {
                  const multiple = segment.items.length > 1;
                  const label = multiple
                    ? `${segment.items.length} пунктов · ${timeLabel(segment.start)}–${tickLabel(segment.end)}`
                    : `${segment.items[0].title} · ${timeLabel(segment.items[0].starts_at)}–${timeLabel(segment.items[0].ends_at)}`;
                  return (
                    <button
                      type="button"
                      key={segment.id}
                      className={`timeline-segment ${multiple ? "timeline-cluster" : ""}`}
                      aria-label={label}
                      aria-pressed={segment.items.some(
                        (item) => item.id === selected?.id,
                      )}
                      title={`${label} · ${track.name}`}
                      style={{
                        left: `${((segment.start - start) * 100) / (end - start)}%`,
                        width: `${((segment.end - segment.start) * 100) / (end - start)}%`,
                        background: segmentBackground(segment, colors),
                      }}
                      onClick={() => selectSegment(segment)}
                    >
                      {multiple ? (
                        <span>
                          <Layers size={13} aria-hidden="true" />
                          <b>{segment.items.length}</b>
                        </span>
                      ) : (
                        <span>{segment.items[0].title}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          {tracks.length === 0 && (
            <p className="timeline-empty">
              На этот день пока ничего не запланировано.
            </p>
          )}
        </div>
      </div>
      {selected && (
        <article
          className="timeline-detail"
          aria-label="Выбранный пункт программы"
          style={{ borderLeftColor: colors.get(selected.id) }}
        >
          <div className="timeline-detail-copy">
            <p className="timeline-detail-time">
              {dateLabel(selected.starts_at)} · {timeLabel(selected.starts_at)}–
              {dateKey(selected.starts_at) !== dateKey(selected.ends_at)
                ? `${dateLabel(selected.ends_at)} `
                : ""}
              {timeLabel(selected.ends_at)} МСК
            </p>
            <h4>{selected.title}</h4>
            <p>
              {selected.room_name}
              {selected.speaker ? ` · ${selected.speaker}` : ""}
            </p>
            {selected.description && (
              <p className="timeline-detail-description">
                {selected.description}
              </p>
            )}
            <small>
              {selected.taken} занято ·{" "}
              {Math.max(0, selected.capacity - selected.taken)} свободно
              {selected.waiting_count > 0
                ? ` · в очереди: ${selected.waiting_count}`
                : ""}
            </small>
          </div>
          <div className="timeline-detail-actions">
            <div className="timeline-selection-nav">
              <button
                className="icon-button"
                aria-label="Предыдущий пункт программы"
                disabled={selectedIndex <= 0}
                onClick={() => selectItem(items[selectedIndex - 1])}
              >
                <ChevronLeft size={18} />
              </button>
              <span>
                {selectedIndex + 1} / {items.length}
              </span>
              <button
                className="icon-button"
                aria-label="Следующий пункт программы"
                disabled={selectedIndex === items.length - 1}
                onClick={() => selectItem(items[selectedIndex + 1])}
              >
                <ChevronRight size={18} />
              </button>
            </div>
            <button
              className="button secondary small-button"
              onClick={() => onEdit(selected)}
              aria-label={`Изменить пункт программы ${selected.title}`}
            >
              <Pencil size={16} />
              Изменить
            </button>
          </div>
        </article>
      )}
      <button
        className="text-button timeline-list-toggle"
        aria-expanded={listOpen}
        aria-controls={`${id}-list`}
        onClick={() => {
          setListOpen(!listOpen);
          setGroupIds(null);
          setPage(0);
        }}
      >
        <List size={17} />
        {listOpen ? "Скрыть список" : `Найти пункт в списке · ${items.length}`}
      </button>
      {listOpen && (
        <div className="timeline-list" id={`${id}-list`}>
          {groupIds && (
            <div className="timeline-group-heading">
              <strong>В выбранной группе: {groupIds.length}</strong>
              <button
                className="text-button"
                onClick={() => {
                  setGroupIds(null);
                  setPage(0);
                }}
              >
                Все пункты дня
              </button>
            </div>
          )}
          <label className="timeline-search">
            <Search size={17} />
            <input
              type="search"
              aria-label="Найти пункт программы"
              placeholder="Название, спикер или аудитория"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0);
              }}
            />
          </label>
          <ul>
            {visibleItems.map((item) => (
              <li key={item.id}>
                <button
                  aria-pressed={item.id === selected?.id}
                  onClick={() => selectItem(item)}
                >
                  <i
                    aria-hidden="true"
                    style={{ background: colors.get(item.id) }}
                  />
                  <time>
                    {timeLabel(item.starts_at)}–{timeLabel(item.ends_at)}
                  </time>
                  <span>
                    <strong>{item.title}</strong>
                    <small>
                      {item.room_name}
                      {item.speaker ? ` · ${item.speaker}` : ""}
                    </small>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {!listItems.length && (
            <p className="timeline-empty">
              Пункты не найдены. Попробуйте другой запрос.
            </p>
          )}
          {pageCount > 1 && (
            <nav
              className="timeline-pagination"
              aria-label="Страницы пунктов программы"
            >
              <button
                className="icon-button"
                aria-label="Предыдущая страница пунктов"
                disabled={currentPage === 0}
                onClick={() => setPage(currentPage - 1)}
              >
                <ChevronLeft size={18} />
              </button>
              <span>
                {currentPage * PAGE_SIZE + 1}–
                {Math.min(listItems.length, (currentPage + 1) * PAGE_SIZE)} из{" "}
                {listItems.length}
              </span>
              <button
                className="icon-button"
                aria-label="Следующая страница пунктов"
                disabled={currentPage === pageCount - 1}
                onClick={() => setPage(currentPage + 1)}
              >
                <ChevronRight size={18} />
              </button>
            </nav>
          )}
        </div>
      )}
    </section>
  );
}
