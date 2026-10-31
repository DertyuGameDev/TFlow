import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  ArrowRight,
  CalendarDays,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  Clock3,
  MapPin,
  Plus,
  SlidersHorizontal,
  Video,
  Users,
} from "lucide-react";
import type { Bootstrap, FlowEvent } from "../../lib/types";
import { dateLabel, timeLabel } from "../../lib/time";
import { canEnterWebinar } from "../../lib/webinars";
import {
  calendarDate,
  calendarEntries,
  dayStart,
  entriesForDay,
  isCalendarDate,
  MINUTE_MS,
  monthDays,
  positionDayEntries,
  shiftDays,
  shiftMonths,
  type CalendarEntry,
  type CalendarSource,
} from "../../lib/calendar";
import { Modal } from "./dialog";
import { FormError } from "./forms";
import "../calendar.css";

type View = "month" | "day";
type Props = {
  data: Bootstrap;
  userId: string;
  initialDate?: string;
  initialView?: string;
  canCreate: boolean;
  onOpenEvent: (entry: CalendarEntry) => void;
  onOpenWebinar: (event: FlowEvent) => void;
  onCreate: (start: number) => void;
  onBrowse: () => void;
  onCancelEvent: (event: FlowEvent) => void;
  onCancelActivity: (activityId: string) => Promise<void>;
};
const weekdays = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const fullWeekdays = [
  "Понедельник",
  "Вторник",
  "Среда",
  "Четверг",
  "Пятница",
  "Суббота",
  "Воскресенье",
];
const sources: { id: CalendarSource; title: string }[] = [
  { id: "ticket", title: "Я участвую" },
  { id: "activity", title: "Активности" },
  { id: "owned", title: "Я организую" },
];
const hourHeight = 64;
const longDate = (date: string) =>
  dateLabel(dayStart(date), { weekday: "long", year: "numeric" });
const monthLabel = (date: string) =>
  dateLabel(dayStart(date), {
    day: undefined,
    month: "long",
    year: "numeric",
  }).replace(/\s*г\.$/, "");
const dayCount = (count: number) =>
  `${count} ${count % 100 >= 11 && count % 100 <= 14 ? "планов" : count % 10 === 1 ? "план" : count % 10 >= 2 && count % 10 <= 4 ? "плана" : "планов"}`;

function SourceFilters({
  enabled,
  onToggle,
  showOwned,
}: {
  enabled: Set<CalendarSource>;
  onToggle: (source: CalendarSource) => void;
  showOwned: boolean;
}) {
  return (
    <div className="cal-sources">
      {sources
        .filter((source) => showOwned ? source.id === "owned" : source.id !== "owned")
        .map((source) => (
          <label
            className={`cal-source cal-source-${source.id}`}
            key={source.id}
          >
            <input
              type="checkbox"
              checked={enabled.has(source.id)}
              onChange={() => onToggle(source.id)}
            />
            <span>{source.title}</span>
          </label>
        ))}
    </div>
  );
}

function CalendarItem({
  entry,
  onClick,
  date,
}: {
  entry: CalendarEntry;
  onClick: () => void;
  date: string;
}) {
  const continuation = entry.starts_at < dayStart(date);
  return (
    <button
      type="button"
      className={`cal-month-event cal-color-${entry.source} ${entry.draft ? "cal-draft" : ""}`}
      onClick={onClick}
      title={`${entry.title} · ${timeLabel(entry.starts_at)}–${timeLabel(entry.ends_at)}`}
      aria-label={`${entry.title}, ${longDate(calendarDate(entry.starts_at))}, ${timeLabel(entry.starts_at)}–${timeLabel(entry.ends_at)}${entry.draft ? ", черновик" : ""}`}
    >
      <span className="cal-event-dot" />
      <time>{continuation ? "↳" : timeLabel(entry.starts_at)}</time>
      <span className="cal-event-name">{entry.title}</span>
    </button>
  );
}

export function Calendar({
  data,
  userId,
  initialDate,
  initialView,
  canCreate,
  onOpenEvent,
  onOpenWebinar,
  onCreate,
  onBrowse,
  onCancelEvent,
  onCancelActivity,
}: Props) {
  const [date, setDate] = useState(() =>
    isCalendarDate(initialDate) ? initialDate : calendarDate(Date.now()),
  );
  const [view, setView] = useState<View>(() =>
    initialView === "day" ? "day" : "month",
  );
  const [enabled, setEnabled] = useState(
    () =>
      new Set<CalendarSource>(
        canCreate ? ["owned"] : ["ticket", "activity"],
      ),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState("");
  const cancelling = useRef(false);
  const [now, setNow] = useState(Date.now);
  const scroller = useRef<HTMLDivElement>(null);
  const monthTable = useRef<HTMLTableElement>(null);
  const focusDate = useRef(false);
  const scrollKey = useRef("");
  const today = calendarDate(now);
  const entries = useMemo(() => calendarEntries(data, userId), [data, userId]);
  const selected = entries.find((entry) => entry.id === selectedId) ?? null;
  const visible = useMemo(
    () => entries.filter((entry) => enabled.has(entry.source)),
    [entries, enabled],
  );
  const days = useMemo(() => monthDays(date), [date]);
  const daysWithEntries = useMemo(
    () => new Map(days.map((day) => [day, entriesForDay(visible, day)])),
    [days, visible],
  );
  const dayEntries = useMemo(
    () => entriesForDay(visible, date),
    [visible, date],
  );
  const allDay = dayEntries.filter(
    (segment) => segment.startMinute === 0 && segment.endMinute === 1440,
  );
  const timed = positionDayEntries(
    dayEntries.filter(
      (segment) => segment.startMinute !== 0 || segment.endMinute !== 1440,
    ),
  );
  const initialHour =
    date === today
      ? Math.max(0, Math.floor((now - dayStart(date)) / (60 * MINUTE_MS)) - 1)
      : Math.max(0, Math.floor((timed[0]?.startMinute ?? 540) / 60) - 1);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (selectedId && !selected) setSelectedId(null);
  }, [selectedId, selected]);
  useEffect(() => {
    if (view !== "day") {
      scrollKey.current = "";
      return;
    }
    if (scroller.current && scrollKey.current !== date) {
      scroller.current.scrollTop = initialHour * hourHeight;
      scrollKey.current = date;
    }
  }, [view, date, initialHour]);
  useEffect(() => {
    if (focusDate.current && view === "month") {
      monthTable.current
        ?.querySelector<HTMLButtonElement>(`[data-date="${date}"]`)
        ?.focus();
      focusDate.current = false;
    }
  }, [date, view]);

  function navigate(nextDate: string, nextView: View = view) {
    if (!isCalendarDate(nextDate)) return;
    setDate(nextDate);
    setView(nextView);
    window.history.replaceState(null, "", `#calendar/${nextDate}/${nextView}`);
  }
  function openEntry(entry: CalendarEntry) {
    setSelectedId(entry.id);
    setConfirmCancel(false);
    setCancelError("");
  }
  async function cancelActivity() {
    if (!selected?.activityId || cancelling.current) return;
    const entryId = selected.id;
    cancelling.current = true;
    setCancelBusy(true);
    setCancelError("");
    try {
      await onCancelActivity(selected.activityId);
      setSelectedId((current) => (current === entryId ? null : current));
    } catch (reason) {
      setCancelError(
        reason instanceof Error
          ? reason.message
          : "Не удалось отменить запись. Повторите попытку.",
      );
    } finally {
      cancelling.current = false;
      setCancelBusy(false);
    }
  }
  function toggleSource(source: CalendarSource) {
    setEnabled((previous) => {
      const next = new Set(previous);
      if (next.has(source)) next.delete(source);
      else next.add(source);
      return next;
    });
  }
  function goToday() {
    navigate(today);
    if (view === "day")
      scroller.current?.scrollTo({
        top:
          Math.max(0, (now - dayStart(today)) / (60 * MINUTE_MS) - 1) *
          hourHeight,
      });
  }
  function move(amount: number) {
    navigate(
      view === "month" ? shiftMonths(date, amount) : shiftDays(date, amount),
    );
  }
  function handleMonthKey(event: KeyboardEvent<HTMLTableElement>) {
    if (
      !(event.target instanceof HTMLButtonElement) ||
      !event.target.dataset.date
    )
      return;
    const day = event.target.dataset.date;
    const movement: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
    };
    let next: string;
    if (event.key in movement) next = shiftDays(day, movement[event.key]);
    else if (event.key === "PageUp" || event.key === "PageDown")
      next = shiftMonths(day, event.key === "PageUp" ? -1 : 1);
    else return;
    event.preventDefault();
    focusDate.current = true;
    navigate(next);
  }
  const selectedEvent =
    selected?.source === "ticket"
      ? data.tickets.find((event) => event.id === selected.eventId)
      : undefined;
  const webinarEvent = selected
    ? [...data.events, ...data.tickets].find(
        (event) =>
          event.id === selected.eventId && canEnterWebinar(event, userId, now),
      )
    : undefined;
  const createStart =
    date === today
      ? Math.ceil((now + 15 * MINUTE_MS) / (30 * MINUTE_MS)) * 30 * MINUTE_MS
      : dayStart(date) + 10 * 60 * MINUTE_MS;

  return (
    <section className="calendar-page" aria-label="Личный календарь">
      <header className="calendar-page-heading">
        <div>
          <span className="calendar-kicker">
            <CalendarRange size={17} /> Всё по плану
          </span>
          <h1>Календарь</h1>
          <p>Больше встреч. Меньше «когда это было?»</p>
        </div>
        {canCreate ? (
          <button
            className="button primary"
            onClick={() => onCreate(createStart)}
          >
            <Plus size={19} />
            Создать событие
          </button>
        ) : (
          <button className="button secondary" onClick={onBrowse}>
            <Plus size={18} />
            Найти событие
          </button>
        )}
      </header>
      <div className="calendar-shell">
        <aside className="calendar-sidebar" aria-label="Настройки календаря">
          <div className="cal-mini-heading">
            <strong>{monthLabel(date)}</strong>
            <div>
              <button
                className="cal-icon"
                onClick={() => navigate(shiftMonths(date, -1))}
                aria-label="Предыдущий месяц в мини-календаре"
              >
                <ChevronLeft size={17} />
              </button>
              <button
                className="cal-icon"
                onClick={() => navigate(shiftMonths(date, 1))}
                aria-label="Следующий месяц в мини-календаре"
              >
                <ChevronRight size={17} />
              </button>
            </div>
          </div>
          <div className="cal-mini-weekdays" aria-hidden="true">
            {weekdays.map((day, index) => (
              <span key={index}>{day[0]}</span>
            ))}
          </div>
          <div className="cal-mini-days">
            {days.map((day) => (
              <button
                key={day}
                type="button"
                disabled={!isCalendarDate(day)}
                className={`${day.slice(0, 7) !== date.slice(0, 7) ? "outside" : ""} ${day === today ? "is-today" : ""} ${day === date ? "is-selected" : ""}`}
                aria-label={`Выбрать ${longDate(day)}`}
                aria-pressed={day === date}
                onClick={() => navigate(day)}
              >
                {Number(day.slice(-2))}
              </button>
            ))}
          </div>
          <h2 className="cal-sidebar-title">Что показывать</h2>
          <SourceFilters
            enabled={enabled}
            onToggle={toggleSource}
            showOwned={canCreate}
          />
          <div className="cal-sidebar-note">
            <CalendarDays size={20} />
            <p>
              {canCreate ? "Здесь события, которые вы организуете." : "Здесь ваши записи на события."} Прошедшие встречи остаются на своих датах. Время и место обновляются автоматически.
            </p>
          </div>
          <span className="cal-timezone">
            <Clock3 size={14} /> Московское время · UTC+3
          </span>
        </aside>
        <div className="calendar-main">
          <div className="cal-toolbar">
            <div className="cal-period-controls">
              <button className="cal-today" onClick={goToday}>
                Сегодня
              </button>
              <div className="cal-arrows">
                <button
                  className="cal-icon"
                  onClick={() => move(-1)}
                  aria-label={
                    view === "month" ? "Предыдущий месяц" : "Предыдущий день"
                  }
                >
                  <ChevronLeft size={20} />
                </button>
                <button
                  className="cal-icon"
                  onClick={() => move(1)}
                  aria-label={
                    view === "month" ? "Следующий месяц" : "Следующий день"
                  }
                >
                  <ChevronRight size={20} />
                </button>
              </div>
            </div>
            <h2 className="cal-period" aria-live="polite">
              {view === "month"
                ? monthLabel(date)
                : dateLabel(dayStart(date), {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}
            </h2>
            <div className="cal-view-controls">
              <label className="cal-date-picker" title="Перейти к дате">
                <CalendarDays size={18} />
                <span className="sr-only">Перейти к дате</span>
                <input
                  type="date"
                  aria-label="Перейти к дате"
                  min="1900-01-01"
                  max="9999-12-31"
                  value={date}
                  onInput={(event) => navigate(event.currentTarget.value)}
                  onChange={(event) => navigate(event.target.value)}
                />
              </label>
              <div
                className="cal-view-switch"
                role="group"
                aria-label="Вид календаря"
              >
                <button
                  aria-pressed={view === "month"}
                  onClick={() => navigate(date, "month")}
                >
                  Месяц
                </button>
                <button
                  aria-pressed={view === "day"}
                  onClick={() => navigate(date, "day")}
                >
                  День
                </button>
              </div>
            </div>
          </div>
          <details className="cal-mobile-filters">
            <summary>
              <SlidersHorizontal size={16} />
              Что показывать<span>МСК · UTC+3</span>
            </summary>
            <SourceFilters
              enabled={enabled}
              onToggle={toggleSource}
              showOwned={canCreate}
            />
          </details>
          {enabled.size === 0 && (
            <p className="cal-filter-notice" role="status">
              Календари скрыты. Включите нужные, чтобы увидеть свои планы.
            </p>
          )}
          {view === "month" ? (
            <div className="cal-month-view">
              <table
                className="cal-month"
                ref={monthTable}
                onKeyDown={handleMonthKey}
              >
                <caption className="sr-only">
                  {monthLabel(date)}. Выберите день, чтобы увидеть расписание по
                  часам. Для перехода между датами используйте стрелки.
                </caption>
                <thead>
                  <tr>
                    {weekdays.map((day, index) => (
                      <th
                        key={day}
                        scope="col"
                        className={index > 4 ? "weekend" : ""}
                      >
                        <abbr title={fullWeekdays[index]}>{day}</abbr>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: days.length / 7 }, (_, week) => (
                    <tr key={week}>
                      {days.slice(week * 7, week * 7 + 7).map((day, index) => {
                        const items = daysWithEntries.get(day) ?? [];
                        return (
                          <td
                            key={day}
                            className={`cal-month-cell ${index > 4 ? "weekend" : ""} ${day.slice(0, 7) !== date.slice(0, 7) ? "outside" : ""} ${day === date ? "is-selected" : ""}`}
                          >
                            <button
                              className="cal-day-open"
                              data-date={day}
                              tabIndex={day === date ? 0 : -1}
                              disabled={!isCalendarDate(day)}
                              aria-label={`Открыть ${longDate(day)}, ${dayCount(items.length)}`}
                              aria-current={day === today ? "date" : undefined}
                              onClick={() => navigate(day, "day")}
                            />
                            <span
                              className={`cal-day-number ${day === today ? "is-today" : ""}`}
                            >
                              {Number(day.slice(-2))}
                              {day.endsWith("-01") && (
                                <small>
                                  {dateLabel(dayStart(day), {
                                    day: undefined,
                                    month: "short",
                                  })}
                                </small>
                              )}
                            </span>
                            <div className="cal-month-events">
                              {items.slice(0, 3).map(({ entry }) => (
                                <CalendarItem
                                  key={entry.id}
                                  entry={entry}
                                  date={day}
                                  onClick={() => openEntry(entry)}
                                />
                              ))}
                              {items.length > 3 && (
                                <button
                                  className="cal-more"
                                  onClick={() => navigate(day, "day")}
                                >
                                  Ещё {items.length - 3}
                                </button>
                              )}
                            </div>
                            <div className="cal-month-dots" aria-hidden="true">
                              {items.slice(0, 3).map(({ entry }) => (
                                <span
                                  className={`cal-dot-${entry.source}`}
                                  key={entry.id}
                                />
                              ))}
                              {items.length > 3 && (
                                <small>+{items.length - 3}</small>
                              )}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="cal-month-hint">
                Нажмите на дату, чтобы увидеть день по часам
              </p>
            </div>
          ) : (
            <div className="cal-day-view">
              <div className="cal-day-heading">
                <span className="cal-zone-label">МСК</span>
                <div>
                  <span>
                    {dateLabel(dayStart(date), {
                      weekday: "long",
                      day: undefined,
                      month: undefined,
                    })}
                  </span>
                  <strong className={date === today ? "is-today" : ""}>
                    {Number(date.slice(-2))}
                  </strong>
                </div>
                <span className="cal-day-count" role="status">
                  {dayCount(dayEntries.length)}
                </span>
              </div>
              {allDay.length > 0 && (
                <div className="cal-all-day">
                  <span>Весь день</span>
                  <div>
                    {allDay.map(({ entry }) => (
                      <CalendarItem
                        key={entry.id}
                        entry={entry}
                        date={date}
                        onClick={() => openEntry(entry)}
                      />
                    ))}
                  </div>
                </div>
              )}
              <div
                className="cal-day-scroll"
                ref={scroller}
                aria-label="Расписание дня по часам"
                tabIndex={0}
              >
                <div
                  className="cal-day-body"
                  style={{ height: 24 * hourHeight }}
                >
                  <div className="cal-hour-labels" aria-hidden="true">
                    {Array.from({ length: 24 }, (_, hour) => (
                      <span key={hour} style={{ top: hour * hourHeight }}>
                        {String(hour).padStart(2, "0")}:00
                      </span>
                    ))}
                  </div>
                  <div
                    className="cal-day-track"
                    style={{ backgroundSize: `100% ${hourHeight}px` }}
                  >
                    {timed.map((segment) => (
                      <button
                        key={segment.entry.id}
                        className={`cal-timed-event cal-color-${segment.entry.source} ${segment.entry.draft ? "cal-draft" : ""} ${segment.displayEnd - segment.startMinute < 50 ? "cal-compact" : ""} ${segment.endMinute - segment.startMinute < 90 ? "cal-brief" : ""}`}
                        style={{
                          top: (segment.startMinute / 60) * hourHeight,
                          height:
                            ((segment.displayEnd - segment.startMinute) / 60) *
                              hourHeight -
                            2,
                          left: `calc(${(segment.column / segment.columns) * 100}% + 5px)`,
                          width: `calc(${100 / segment.columns}% - 10px)`,
                        }}
                        title={`${segment.entry.title} · ${timeLabel(segment.entry.starts_at)}–${timeLabel(segment.entry.ends_at)}`}
                        aria-label={`${segment.entry.title}, ${timeLabel(segment.entry.starts_at)}–${timeLabel(segment.entry.ends_at)}${segment.entry.draft ? ", черновик" : ""}`}
                        onClick={() => openEntry(segment.entry)}
                      >
                        <strong>{segment.entry.title}</strong>
                        <span>
                          {segment.continuesBefore
                            ? "с предыдущего дня"
                            : timeLabel(segment.entry.starts_at)}{" "}
                          —{" "}
                          {segment.continuesAfter
                            ? "на следующий день"
                            : timeLabel(segment.entry.ends_at)}
                        </span>
                        <small>{segment.entry.location}</small>
                        {segment.entry.draft && <em>Черновик</em>}
                      </button>
                    ))}
                    {date === today && (
                      <div
                        className="cal-now-line"
                        style={{
                          top:
                            ((now - dayStart(date)) / (60 * MINUTE_MS)) *
                            hourHeight,
                        }}
                        aria-label={`Сейчас ${timeLabel(now)}`}
                      >
                        <span />
                      </div>
                    )}
                    {dayEntries.length === 0 && (
                      <div
                        className="cal-empty-day"
                        style={{ top: 9 * hourHeight }}
                      >
                        <CalendarDays size={28} />
                        <strong>День без спешки</strong>
                        <p>
                          {enabled.size
                            ? "Здесь пока нет запланированных событий."
                            : "Выберите календари, которые хотите видеть."}
                        </p>
                        <button className="text-button" onClick={onBrowse}>
                          Найти интересное событие
                          <ArrowRight size={15} />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      {selected && (
        <Modal
          title={selected.title}
          subtitle={
            sources.find((source) => source.id === selected.source)?.title
          }
          onClose={() => setSelectedId(null)}
        >
          <div className="cal-entry-details">
            <p>
              <Clock3 size={19} />
              <span>
                {dateLabel(selected.starts_at)} ·{" "}
                {timeLabel(selected.starts_at)} —{" "}
                {calendarDate(selected.starts_at) !==
                calendarDate(selected.ends_at)
                  ? `${dateLabel(selected.ends_at)} · `
                  : ""}
                {timeLabel(selected.ends_at)}
                <small>Московское время</small>
              </span>
            </p>
            {selected.location && (
              <p>
                <MapPin size={19} />
                <span>{selected.location}</span>
              </p>
            )}
            {selected.eventTitle && (
              <p>
                <CalendarDays size={19} />
                <span>{selected.eventTitle}</span>
              </p>
            )}
            {selected.draft && (
              <span className="cal-detail-draft">
                Черновик · виден только вам
              </span>
            )}
            {selected.description && (
              <div className="cal-entry-description">
                {selected.description}
              </div>
            )}
            <p>
              <Users size={19} />
              <span>
                Свободно {Math.max(0, selected.capacity - selected.taken)} из{" "}
                {selected.capacity} мест
              </span>
            </p>
            {selected.activityId && (
              <div className="cal-cancel-activity">
                {confirmCancel ? (
                  <>
                    <p>
                      Отменить запись на эту активность? Место станет доступно
                      другим участникам. Регистрация на мероприятие сохранится.
                    </p>
                    <div>
                      <button
                        className="button secondary"
                        disabled={cancelBusy}
                        onClick={() => setConfirmCancel(false)}
                      >
                        Оставить запись
                      </button>
                      <button
                        className="button danger-button"
                        disabled={cancelBusy}
                        onClick={() => void cancelActivity()}
                      >
                        {cancelBusy ? "Отменяем…" : "Подтвердить отмену"}
                      </button>
                    </div>
                  </>
                ) : (
                  <button
                    className="text-button"
                    disabled={cancelBusy}
                    onClick={() => setConfirmCancel(true)}
                  >
                    Отменить запись на активность
                  </button>
                )}
                <FormError error={cancelError} />
              </div>
            )}
            {selectedEvent && (
              <p className="cal-registration-state">
                {selectedEvent.checked_in
                  ? "Вход подтверждён. Регистрация сохранена в календаре."
                  : "Вы зарегистрированы на это событие."}
              </p>
            )}
            <div className="cal-entry-actions">
              {webinarEvent && (
                <button
                  className="button primary"
                  onClick={() => {
                    setSelectedId(null);
                    onOpenWebinar(webinarEvent);
                  }}
                >
                  <Video size={18} />
                  {webinarEvent.owner_id === userId
                    ? "Открыть студию"
                    : "Войти в вебинар"}
                </button>
              )}
              <button
                className={`button ${webinarEvent ? "secondary" : "primary"}`}
                onClick={() => {
                  setSelectedId(null);
                  onOpenEvent(selected);
                }}
              >
                {selected.source === "owned"
                  ? "Управлять событием"
                  : "Открыть событие"}
                <ArrowRight size={18} />
              </button>
              {selectedEvent && !selectedEvent.checked_in && (
                <button
                  className="button danger-outline"
                  onClick={() => {
                    setSelectedId(null);
                    onCancelEvent(selectedEvent);
                  }}
                >
                  Отменить регистрацию
                </button>
              )}
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}
