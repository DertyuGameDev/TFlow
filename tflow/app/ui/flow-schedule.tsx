import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { Check, Clock3, Minus, Pencil, Plus, X } from "lucide-react";
import {
  FLOW_DAY_HEADING,
  flowDuration,
  layoutFlow,
} from "../../lib/flow-layout";
import type { Activity } from "../../lib/types";
import { dateKey, dateLabel, timeLabel } from "../../lib/time";
import "../flow-schedule.css";

export function useFlowClock(activities: Activity[]) {
  const [now, setNow] = useState(Date.now);
  const next = activities.reduce(
    (boundary, item) =>
      Math.min(
        boundary,
        item.starts_at > now ? item.starts_at : Infinity,
        item.ends_at > now ? item.ends_at : Infinity,
      ),
    Infinity,
  );
  useEffect(() => {
    const update = () => setNow(Date.now());
    const timer = window.setTimeout(
      update,
      Math.max(20, Math.min(60_000, next - Date.now() + 20)),
    );
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, [now, next]);
  return now;
}

const COLORS = ["#6ab49d", "#79a9e5", "#ad91d0", "#d7a36b", "#7dabb8"];
function colorFor(room: string) {
  let hash = 0;
  for (const char of room) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return COLORS[hash % COLORS.length];
}
const SCALES = [3, 5, 8, 12, 20, 32];

export function FlowSchedule({
  activities,
  now,
  renderActivity,
  selectedId,
  onEdit,
  label = "Флоу мероприятия",
}: {
  activities: Activity[];
  now: number;
  renderActivity: (activity: Activity) => ReactNode;
  selectedId?: string;
  onEdit?: (activity: Activity) => void;
  label?: string;
}) {
  const [zoom, setZoom] = useState(0),
    [opened, setOpened] = useState("");
  const [viewportWidth, setViewportWidth] = useState(0),
    [scrollX, setScrollX] = useState(0);
  const id = useId(),
    viewport = useRef<HTMLDivElement>(null),
    zoomAnchor = useRef<number | null>(null);
  const layout = useMemo(
    () => layoutFlow(activities, SCALES[zoom]),
    [activities, zoom],
  );
  const openId = selectedId || opened;
  const openItem = layout.placements.find(
    (item) => item.activity.id === openId,
  );
  const nowDay = layout.days.find((day) => day.start <= now && now < day.end);
  const nowY = nowDay
    ? nowDay.top +
      FLOW_DAY_HEADING +
      ((now - nowDay.start) / 60000) * SCALES[zoom]
    : null;
  const minimumWidth =
    layout.maximumLanes > 2 ? 64 + layout.maximumLanes * 160 : undefined;
  const height = Math.max(layout.height, openItem ? openItem.top + 420 : 0);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const measure = () => setViewportWidth(element.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (openId)
      viewport.current
        ?.querySelector<HTMLElement>(".flow-details")
        ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [openId]);
  useEffect(() => {
    if (!opened || selectedId) return;
    function outside(event: PointerEvent) {
      const target = event.target as Element;
      if (!target.closest?.(".flow-event.is-open, .flow-details"))
        setOpened("");
    }
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [opened, selectedId]);
  function close() {
    setOpened("");
    const buttons =
      viewport.current?.querySelectorAll<HTMLButtonElement>(".flow-select");
    [...(buttons ?? [])]
      .find((button) => button.dataset.selectId === openId)
      ?.focus({ preventScroll: true });
  }
  function changeZoom(next: number) {
    const scroller = viewport.current;
    if (scroller) {
      const day =
        layout.days.find(
          (day) =>
            day.top + FLOW_DAY_HEADING + day.height >= scroller.scrollTop,
        ) ?? layout.days.at(-1);
      if (day)
        zoomAnchor.current =
          day.start +
          ((scroller.scrollTop - day.top - FLOW_DAY_HEADING) / SCALES[zoom]) *
            60000;
    }
    setZoom(next);
  }
  useLayoutEffect(() => {
    if (zoomAnchor.current === null || !viewport.current) return;
    const time = zoomAnchor.current;
    const day =
      layout.days.find((day) => day.end >= time) ?? layout.days.at(-1);
    if (day)
      viewport.current.scrollTop =
        day.top +
        FLOW_DAY_HEADING +
        ((time - day.start) / 60000) * SCALES[zoom];
    zoomAnchor.current = null;
  }, [layout, zoom]);

  return (
    <div className="flow-time-map">
      {activities.length > 0 && (
        <div className="flow-map-tools">
          <p>
            Время по МСК <span>Высота полосы — длительность</span>
          </p>
          <div className="flow-map-controls">
            {nowY !== null && (
              <button
                className="text-button flow-jump-now"
                onClick={() =>
                  viewport.current?.scrollTo({
                    top: Math.max(0, nowY - 90),
                    behavior: window.matchMedia?.(
                      "(prefers-reduced-motion: reduce)",
                    ).matches
                      ? "auto"
                      : "smooth",
                  })
                }
              >
                Сейчас
              </button>
            )}
            <div className="flow-scale" role="group" aria-label="Масштаб флоу">
              <button
                aria-label="Уменьшить масштаб флоу"
                disabled={zoom === 0}
                onClick={() => changeZoom(zoom - 1)}
              >
                <Minus size={16} />
              </button>
              <span>
                {zoom === 0
                  ? "Обзор"
                  : `${Math.round((SCALES[zoom] / SCALES[0]) * 100)}%`}
              </span>
              <button
                aria-label="Увеличить масштаб флоу"
                disabled={zoom === SCALES.length - 1}
                onClick={() => changeZoom(zoom + 1)}
              >
                <Plus size={16} />
              </button>
            </div>
          </div>
        </div>
      )}
      <div
        className="flow-map-scroll"
        ref={viewport}
        tabIndex={0}
        role="region"
        aria-label="Временная карта флоу"
        aria-describedby={`${id}-hint`}
        onScroll={(event) => setScrollX(event.currentTarget.scrollLeft)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && opened && !selectedId) {
            event.preventDefault();
            close();
          }
        }}
      >
        <div
          className="flow-map-canvas"
          style={
            {
              height,
              minWidth: minimumWidth,
              "--flow-viewport-width": viewportWidth
                ? `${viewportWidth}px`
                : undefined,
            } as CSSProperties
          }
        >
          {layout.days.map((day) => (
            <div key={day.key} className="flow-day-map">
              <h3 className="flow-date" style={{ top: day.top }}>
                {dateLabel(day.start, { weekday: "long", year: "numeric" })}
                {dateKey(day.end - 1) !== dateKey(day.start) &&
                  ` — ${dateLabel(day.end - 1)}`}
              </h3>
              {day.ticks.map((tick) => (
                <div
                  className="flow-time-tick"
                  key={tick.time}
                  style={{ top: tick.top }}
                >
                  <time dateTime={new Date(tick.time).toISOString()}>
                    {timeLabel(tick.time)}
                    {dateKey(tick.time) !== dateKey(day.start) &&
                      timeLabel(tick.time) === "00:00" && (
                        <small className="flow-tick-date">
                          {dateLabel(tick.time, { month: "short" })}
                        </small>
                      )}
                  </time>
                </div>
              ))}
              {day.gaps.map((gap) => (
                <div
                  key={gap.start}
                  className="flow-time-gap"
                  style={{ top: gap.top, height: gap.height }}
                >
                  <span>Перерыв {flowDuration(gap.end - gap.start)}</span>
                </div>
              ))}
            </div>
          ))}
          {nowY !== null && (
            <div
              className="flow-now-line"
              style={{ top: nowY }}
              aria-hidden="true"
            >
              <span>{timeLabel(now)}</span>
            </div>
          )}
          <ol className="vertical-flow" aria-label={label} style={{ height }}>
            {layout.placements.map((placement) => {
              const a = placement.activity,
                live = a.starts_at <= now && now < a.ends_at,
                past = a.ends_at <= now,
                open = a.id === openId;
              const color = live ? "#e0bb27" : colorFor(a.room_id),
                duration = flowDuration(a.ends_at - a.starts_at);
              const progress = live
                ? Math.max(
                    0,
                    Math.min(
                      100,
                      ((now - a.starts_at) / (a.ends_at - a.starts_at)) * 100,
                    ),
                  )
                : 0;
              return (
                <li
                  key={a.id}
                  className={`flow-event ${live ? "is-live" : ""} ${past ? "is-past" : ""} ${open ? "is-open" : ""} ${placement.height < 68 ? "is-brief" : placement.height < 112 ? "is-medium" : ""} ${placement.height < 14 ? "is-tiny" : ""} ${placement.lanes > 1 ? "is-parallel" : ""} ${onEdit ? "is-editable" : ""} ${a.registered || a.waitlisted ? "has-status" : ""}`}
                  aria-current={live ? "step" : undefined}
                  data-activity-id={a.id}
                  data-duration-minutes={(a.ends_at - a.starts_at) / 60000}
                  style={
                    {
                      top: placement.top,
                      height: placement.height,
                      left: `calc(var(--flow-gutter) + (100% - var(--flow-gutter)) * ${placement.lane / placement.lanes} + 5px)`,
                      width: `calc((100% - var(--flow-gutter)) * ${placement.span / placement.lanes} - 12px)`,
                      "--flow-color": color,
                      "--flow-progress": `${progress}%`,
                    } as CSSProperties
                  }
                >
                  <div className="flow-ribbon">
                    <div className="flow-ribbon-summary" aria-hidden={open}>
                      <span className="flow-ribbon-time">
                        {timeLabel(a.starts_at)}–{timeLabel(a.ends_at)}
                      </span>
                      <h3 id={`${id}-${a.id}-title`}>{a.title}</h3>
                      <span className="flow-ribbon-room">{a.room_name}</span>
                      <span
                        className="flow-ribbon-duration"
                        id={`${id}-${a.id}-duration`}
                      >
                        {duration}
                      </span>
                      {live && <span className="flow-ribbon-live">Сейчас</span>}
                      {!!a.registered && (
                        <Check
                          className="flow-ribbon-registered"
                          size={16}
                          aria-label="Вы записаны"
                        />
                      )}
                      {!!a.waitlisted && (
                        <Clock3
                          className="flow-ribbon-registered"
                          size={16}
                          aria-label="Вы в очереди"
                        />
                      )}
                    </div>
                    <button
                      type="button"
                      className="flow-select"
                      data-select-id={a.id}
                      aria-labelledby={`${id}-${a.id}-title ${id}-${a.id}-duration`}
                      aria-expanded={open}
                      aria-controls={open ? `${id}-details-${a.id}` : undefined}
                      title={`${a.title}: ${timeLabel(a.starts_at)}–${timeLabel(a.ends_at)}, ${a.room_name}. Нажмите для действий.`}
                      onClick={() => setOpened(open ? "" : a.id)}
                    />
                    {onEdit && !open && (
                      <button
                        className="flow-quick-edit"
                        aria-label={`Изменить пункт программы ${a.title}`}
                        onClick={() => onEdit(a)}
                      >
                        <Pencil size={15} />
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
          {openItem && (
            <div
              className="flow-details"
              id={`${id}-details-${openItem.activity.id}`}
              style={
                {
                  top: openItem.top,
                  transform: `translateX(${scrollX}px)`,
                  "--flow-color": colorFor(openItem.activity.room_id),
                } as CSSProperties
              }
            >
              <div className="flow-details-top">
                <span>
                  {flowDuration(
                    openItem.activity.ends_at - openItem.activity.starts_at,
                  )}
                  {openItem.activity.starts_at <= now &&
                  now < openItem.activity.ends_at
                    ? " · Сейчас"
                    : ""}
                </span>
                {!selectedId && (
                  <button
                    className="icon-button"
                    aria-label="Закрыть сведения об активности"
                    onClick={close}
                  >
                    <X size={18} />
                  </button>
                )}
              </div>
              {renderActivity(openItem.activity)}
            </div>
          )}
        </div>
      </div>
      {!!activities.length && (
        <p className="flow-map-hint" id={`${id}-hint`}>
          Нажмите на активность, чтобы открыть подробности. Параллельные
          активности расположены рядом.
        </p>
      )}
    </div>
  );
}
