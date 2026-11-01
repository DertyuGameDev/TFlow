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
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Clock3,
  Minus,
  Pencil,
  Plus,
  X,
} from "lucide-react";
import { flowMarkers } from "../../lib/flow-markers";
import { readableFlow } from "../../lib/readable-flow";
import {
  FLOW_PAGE_SCROLL_QUERY,
  flowOffsetAtTime,
  flowTimeAtOffset,
} from "../../lib/flow-navigation";
import { flowDuration, layoutFlow, type FlowRange } from "../../lib/flow-layout";
import { PROGRAM_COLORS } from "../../lib/program-timeline";
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
    const nextMinute = (Math.floor(now / 60_000) + 1) * 60_000;
    const timer = window.setTimeout(
      update,
      Math.max(20, Math.min(next, nextMinute) - Date.now() + 20),
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

function colorFor(activityId: string) {
  let hash = 0;
  for (const char of activityId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return PROGRAM_COLORS[hash % PROGRAM_COLORS.length];
}
const SCALES = [3, 5, 8, 12, 20, 32, 64];

export function FlowSchedule({
  activities,
  event,
  now,
  renderActivity,
  selectedId,
  onEdit,
  label = "Флоу мероприятия",
}: {
  activities: Activity[];
  event?: FlowRange;
  now: number;
  renderActivity: (activity: Activity) => ReactNode;
  selectedId?: string;
  onEdit?: (activity: Activity) => void;
  label?: string;
}) {
  const [zoom, setZoom] = useState(0),
    [opened, setOpened] = useState("");
  const [viewportWidth, setViewportWidth] = useState(0),
    [scrollX, setScrollX] = useState(0),
    [detailsHeight, setDetailsHeight] = useState(0),
    [headerBottom, setHeaderBottom] = useState(68),
    [toolsHeight, setToolsHeight] = useState(60),
    [panelHeight, setPanelHeight] = useState(480);
  const id = useId(),
    tools = useRef<HTMLDivElement>(null),
    viewport = useRef<HTMLDivElement>(null),
    details = useRef<HTMLDivElement>(null),
    currentTrigger = useRef<HTMLButtonElement | null>(null),
    focusCurrentDetails = useRef(false),
    zoomAnchor = useRef<{
      time: number;
      page: boolean;
      offset: number;
      pageScroll: number;
    } | null>(null);
  const { layout, markers } = useMemo(() => {
    const base = layoutFlow(activities, SCALES[zoom], event);
    return readableFlow(base, flowMarkers(base.placements));
  }, [activities, zoom, event?.starts_at, event?.ends_at]);
  const markerByActivity = new Map(
    markers.flatMap((marker) =>
      marker.items.map((item) => [item.activity.id, marker] as const),
    ),
  );
  const openId = selectedId || opened;
  const currentActivities = activities
    .filter((activity) => activity.starts_at <= now && now < activity.ends_at)
    .sort(
      (a, b) => a.ends_at - b.ends_at || a.title.localeCompare(b.title, "ru"),
    );
  const nextActivity = activities
    .filter((activity) => activity.starts_at > now)
    .sort((a, b) => a.starts_at - b.starts_at)[0];
  const openItem = layout.placements.find(
    (item) => item.activity.id === openId,
  );
  const openMarker = markers.find((marker) => marker.id === openId);
  const detailsAnchor =
    openItem ?? (openMarker && { ...openMarker.items[0], top: openMarker.top });
  const nowDay = layout.days.find((day) => day.start <= now && now < day.end);
  const nowY = nowDay ? flowOffsetAtTime(layout.days, now, SCALES[zoom]) : null;
  const minimumWidth =
    layout.maximumLanes > 2 ? 64 + layout.maximumLanes * 160 : undefined;
  const height = Math.max(
    layout.height,
    detailsAnchor ? detailsAnchor.top + detailsHeight + 8 : 0,
  );
  useLayoutEffect(() => {
    const element = details.current;
    if (!element) return;
    const measure = () => setDetailsHeight(element.offsetHeight);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [openId]);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const header = document.querySelector<HTMLElement>(".flow-topbar");
    const navigation =
      document.querySelector<HTMLElement>(".mobile-bottom-nav");
    const measure = () => {
      setViewportWidth(element.clientWidth);
      const top = header?.getBoundingClientRect().bottom ?? 68;
      setToolsHeight(tools.current?.offsetHeight ?? 60);
      setHeaderBottom(top);
      setPanelHeight(
        Math.max(
          140,
          (window.visualViewport?.height ?? window.innerHeight) -
            top -
            (tools.current?.offsetHeight ?? 60) -
            (navigation?.offsetHeight ?? 0) -
            24,
        ),
      );
    };
    measure();
    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(measure)
        : null;
    observer?.observe(element);
    if (header) observer?.observe(header);
    if (navigation) observer?.observe(navigation);
    if (tools.current) observer?.observe(tools.current);
    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("resize", measure);
    };
  }, [layout.days.length > 0]);
  useEffect(() => {
    if (openId) {
      const panel = details.current;
      panel?.scrollIntoView({ block: "nearest", inline: "nearest" });
      if (focusCurrentDetails.current) {
        panel?.focus({ preventScroll: true });
        focusCurrentDetails.current = false;
      }
    }
  }, [openId]);
  useEffect(() => {
    if (openMarker)
      details.current
        ?.querySelector<HTMLButtonElement>(".flow-short-options button")
        ?.focus({ preventScroll: true });
  }, [openMarker?.id]);
  useEffect(() => {
    if (!opened || selectedId) return;
    function outside(event: PointerEvent) {
      const target = event.target as Element;
      if (
        !target.closest?.(
          ".flow-event.is-open, .flow-short-marker, .flow-details, .flow-current",
        )
      )
        setOpened("");
    }
    // A swipe must not dismiss details and change the chart height mid-scroll.
    document.addEventListener("click", outside, true);
    return () => document.removeEventListener("click", outside, true);
  }, [opened, selectedId]);
  function close() {
    setOpened("");
    if (currentTrigger.current?.dataset.currentId === openId) {
      currentTrigger.current.focus({ preventScroll: true });
      currentTrigger.current = null;
      return;
    }
    const buttons =
      viewport.current?.querySelectorAll<HTMLButtonElement>(".flow-select");
    const focusId = markerByActivity.get(openId)?.id ?? openId;
    [...(buttons ?? [])]
      .find((button) => button.dataset.selectId === focusId)
      ?.focus({ preventScroll: true });
  }
  function changeZoom(next: number) {
    const scroller = viewport.current;
    if (scroller) {
      const page = window.matchMedia?.(FLOW_PAGE_SCROLL_QUERY).matches ?? false;
      const offset = page
        ? Math.max(
            0,
            (tools.current?.getBoundingClientRect().bottom ?? 0) +
              8 -
              scroller.getBoundingClientRect().top,
          )
        : scroller.scrollTop;
      const time = flowTimeAtOffset(layout.days, offset, SCALES[zoom]);
      if (time !== null)
        zoomAnchor.current = { time, page, offset, pageScroll: window.scrollY };
    }
    setZoom(next);
  }
  useLayoutEffect(() => {
    if (zoomAnchor.current === null || !viewport.current) return;
    const anchor = zoomAnchor.current;
    const offset = Math.max(
      0,
      flowOffsetAtTime(layout.days, anchor.time, SCALES[zoom]),
    );
    if (anchor.page)
      window.scrollTo({
        top: anchor.pageScroll + offset - anchor.offset,
        behavior: "instant",
      });
    else viewport.current.scrollTop = offset;
    zoomAnchor.current = null;
  }, [layout, zoom]);

  function jumpToNow() {
    const scroller = viewport.current;
    if (!scroller || nowY === null) return;
    const behavior = window.matchMedia?.("(prefers-reduced-motion: reduce)")
      .matches
      ? "auto"
      : "smooth";
    if (window.matchMedia?.(FLOW_PAGE_SCROLL_QUERY).matches) {
      const safeTop =
        (tools.current?.getBoundingClientRect().bottom ?? 80) + 48;
      window.scrollTo({
        top: Math.max(
          0,
          window.scrollY +
            scroller.getBoundingClientRect().top +
            nowY -
            safeTop,
        ),
        behavior,
      });
    } else scroller.scrollTo({ top: Math.max(0, nowY - 90), behavior });
  }

  return (
    <div
      className={`flow-time-map ${activities.length ? "has-current-list" : ""}`}
      onKeyDown={(event) => {
        if (event.key === "Escape" && opened && !selectedId) {
          event.preventDefault();
          close();
        }
      }}
      style={
        {
          "--flow-header-bottom": `${headerBottom}px`,
          "--flow-tools-height": `${toolsHeight}px`,
          "--flow-panel-height": `${panelHeight}px`,
        } as CSSProperties
      }
    >
      {layout.days.length > 0 && (
        <div className="flow-map-tools" ref={tools}>
          <p>
            Время по МСК{" "}
            <span>
              {markers.length
                ? "Короткие пункты показаны крупнее"
                : "Высота полосы — длительность"}
            </span>
          </p>
          <div className="flow-map-controls">
            {nowY !== null && (
              <button className="text-button flow-jump-now" onClick={jumpToNow}>
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
        aria-describedby={layout.days.length ? `${id}-hint` : undefined}
        onScroll={(event) => setScrollX(event.currentTarget.scrollLeft)}
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
              "--flow-scroll-x": `${scrollX}px`,
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
                  className={`flow-time-tick ${nowY !== null && Math.abs(tick.top - nowY) < 32 ? "is-near-now" : ""}`}
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
            </div>
          ))}
          {nowY !== null && (
            <div
              className="flow-now-line"
              style={{ top: nowY }}
            >
              <time dateTime={new Date(now).toISOString()} aria-label={`Сейчас ${timeLabel(now)}, МСК`}>
                {timeLabel(now)}
              </time>
            </div>
          )}
          <ol className="vertical-flow" aria-label={label} style={{ height }}>
            {layout.placements.map((placement) => {
              const a = placement.activity,
                live = a.starts_at <= now && now < a.ends_at,
                past = a.ends_at <= now,
                open = a.id === openId;
              const marked = markerByActivity.has(a.id);
              const color = colorFor(a.id),
                duration = flowDuration(a.ends_at - a.starts_at);
              const progress =
                live && nowY !== null
                  ? Math.max(
                      0,
                      Math.min(
                        100,
                        ((nowY - placement.top) / placement.height) * 100,
                      ),
                    )
                  : 0;
              return (
                <li
                  key={a.id}
                  className={`flow-event ${live ? "is-live" : ""} ${past ? "is-past" : ""} ${open ? "is-open" : ""} ${marked ? "has-short-marker" : ""} ${placement.height < 88 ? "is-brief" : placement.height < 176 ? "is-medium" : ""} ${placement.lanes > 1 ? "is-parallel" : ""} ${onEdit ? "is-editable" : ""} ${a.registered || a.waitlisted ? "has-status" : ""}`}
                  aria-current={live && !marked ? "step" : undefined}
                  aria-hidden={marked || undefined}
                  data-activity-id={a.id}
                  data-duration-minutes={(a.ends_at - a.starts_at) / 60000}
                  style={
                    {
                      top: placement.top,
                      height: placement.height,
                      left: `calc(var(--flow-gutter) + (100% - var(--flow-gutter)) * ${placement.lane / placement.lanes} + 4px)`,
                      width: `calc((100% - var(--flow-gutter)) * ${placement.span / placement.lanes} - 8px)`,
                      "--flow-color": color,
                      "--flow-item-inset": `${Math.min(4, Math.max(0.5, (placement.height - 18) / 2))}px`,
                      "--flow-progress": `${progress}%`,
                    } as CSSProperties
                  }
                >
                  <div className="flow-ribbon">
                    <div className="flow-ribbon-summary" aria-hidden={open}>
                      <h3 id={`${id}-${a.id}-title`}>{a.title}</h3>
                      <div className="flow-ribbon-meta">
                        <span className="flow-ribbon-time">
                          {timeLabel(a.starts_at)}–{timeLabel(a.ends_at)}
                        </span>
                        <span
                          className="flow-ribbon-duration"
                          id={`${id}-${a.id}-duration`}
                        >
                          {duration}
                        </span>
                      </div>
                      <span className="flow-ribbon-room">{a.room_name}</span>
                      {live && <span className="flow-ribbon-live">Сейчас</span>}
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
                    {((onEdit && !open) ||
                      !!a.registered ||
                      !!a.waitlisted) && (
                      <div
                        className="flow-ribbon-actions"
                        aria-hidden={open || undefined}
                      >
                        {onEdit && !open && (
                          <button
                            className="flow-quick-edit"
                            aria-label={`Изменить пункт программы ${a.title}`}
                            onClick={() => onEdit(a)}
                          >
                            <Pencil size={15} />
                          </button>
                        )}
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
                    )}
                  </div>
                </li>
              );
            })}
            {markers.map((marker) => {
              const single =
                marker.items.length === 1 ? marker.items[0].activity : null;
              const live = marker.items.some(
                ({ activity: a }) => a.starts_at <= now && now < a.ends_at,
              );
              const open =
                marker.id === openId ||
                marker.items.some(({ activity }) => activity.id === openId);
              const color = colorFor(marker.items[0].activity.id);
              const name = single ? single.title : "Короткие активности";
              const duration = single
                ? flowDuration(single.ends_at - single.starts_at)
                : "";
              return (
                <li
                  key={marker.id}
                  className={`flow-short-marker ${live ? "is-live" : ""} ${open ? "is-open" : ""}`}
                  aria-current={live ? "step" : undefined}
                  style={
                    {
                      top: marker.top,
                      height: marker.height,
                      left: `calc(var(--flow-gutter) + (100% - var(--flow-gutter)) * ${marker.left} + 4px)`,
                      width: `calc((100% - var(--flow-gutter)) * ${marker.right - marker.left} - 8px)`,
                      "--flow-color": color,
                    } as CSSProperties
                  }
                >
                  <div className="flow-short-chip">
                    <span className="flow-short-title">{name}</span>
                    <span className="flow-short-duration">
                      {single ? duration : marker.items.length}
                    </span>
                    <button
                      type="button"
                      className="flow-select"
                      data-select-id={marker.id}
                      aria-label={
                        single
                          ? `${name} ${duration}`
                          : `${name}: ${marker.items.length}`
                      }
                      aria-expanded={open}
                      aria-controls={
                        open ? `${id}-details-${openId}` : undefined
                      }
                      title={
                        single
                          ? `${name}: ${timeLabel(single.starts_at)}–${timeLabel(single.ends_at)}, ${duration}`
                          : name
                      }
                      onClick={() =>
                        setOpened(open ? "" : (single?.id ?? marker.id))
                      }
                    />
                  </div>
                </li>
              );
            })}
          </ol>
          {detailsAnchor && (
            <div
              ref={details}
              className="flow-details"
              role="region"
              tabIndex={-1}
              aria-label={
                selectedId
                  ? "Редактирование активности"
                  : "Сведения об активности"
              }
              id={`${id}-details-${openId}`}
              style={
                {
                  top: detailsAnchor.top,
                  left: `clamp(calc(var(--flow-gutter) + 4px), calc(var(--flow-gutter) + (100% - var(--flow-gutter)) * ${detailsAnchor.lane / detailsAnchor.lanes} - ${scrollX}px + 4px), calc(var(--flow-viewport-width, 100%) - var(--flow-details-width) - 4px))`,
                  transform: `translateX(${scrollX}px)`,
                  "--flow-color": colorFor(detailsAnchor.activity.id),
                } as CSSProperties
              }
            >
              <div className="flow-details-top">
                {openItem &&
                  !selectedId &&
                  (markerByActivity.get(openId)?.items.length ?? 0) > 1 && (
                    <button
                      className="text-button flow-short-back"
                      aria-label="Назад к коротким активностям"
                      onClick={() =>
                        setOpened(markerByActivity.get(openId)!.id)
                      }
                    >
                      <ArrowLeft size={16} />К списку
                    </button>
                  )}
                <span>
                  {openItem
                    ? flowDuration(
                        openItem.activity.ends_at - openItem.activity.starts_at,
                      )
                    : `Короткие активности · ${openMarker?.items.length}`}
                  {openItem &&
                  openItem.activity.starts_at <= now &&
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
              {openItem ? (
                renderActivity(openItem.activity)
              ) : (
                <ul className="flow-short-options">
                  {openMarker?.items.map(({ activity: a }) => (
                    <li key={a.id}>
                      <button type="button" onClick={() => setOpened(a.id)}>
                        <strong>{a.title}</strong>
                        <span>
                          {timeLabel(a.starts_at)}–{timeLabel(a.ends_at)} ·{" "}
                          {flowDuration(a.ends_at - a.starts_at)}
                        </span>
                        <span>{a.room_name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
      {!!layout.days.length && (
        <p className="flow-map-hint" id={`${id}-hint`}>
          {activities.length ? (
            <>Нажмите на активность, чтобы открыть подробности. Параллельные
            активности расположены рядом.</>
          ) : "Показан весь интервал мероприятия. Активностей в этом диапазоне пока нет."}
        </p>
      )}
      {!!activities.length && (
        <aside className="flow-current" aria-labelledby={`${id}-current-title`}>
          <div className="flow-current-heading">
            <h3 id={`${id}-current-title`}>Сейчас идут</h3>
            <span
              aria-label={`Активностей сейчас: ${currentActivities.length}`}
            >
              {currentActivities.length}
            </span>
          </div>
          {currentActivities.length ? (
            <ul className="flow-current-list" aria-label="Текущие активности">
              {currentActivities.map((activity) => (
                <li key={activity.id}>
                  <button
                    type="button"
                    className="flow-current-item"
                    data-current-id={activity.id}
                    aria-label={`Открыть активность ${activity.title}`}
                    aria-expanded={openId === activity.id}
                    aria-controls={
                      openId === activity.id
                        ? `${id}-details-${activity.id}`
                        : undefined
                    }
                    disabled={!!selectedId && selectedId !== activity.id}
                    onClick={(event) => {
                      currentTrigger.current = event.currentTarget;
                      if (openId === activity.id) {
                        details.current?.focus({ preventScroll: true });
                      } else {
                        focusCurrentDetails.current = true;
                        setOpened(activity.id);
                      }
                    }}
                    style={
                      {
                        "--flow-color": colorFor(activity.id),
                      } as CSSProperties
                    }
                  >
                    <span className="flow-current-time">
                      {timeLabel(activity.starts_at)}–
                      {timeLabel(activity.ends_at)}
                    </span>
                    <strong>{activity.title}</strong>
                    <span className="flow-current-room">
                      {activity.room_name}
                    </span>
                    <ChevronRight size={18} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="flow-current-empty">
              <p>Сейчас активностей нет</p>
              {nextActivity && (
                <p>
                  Следующая —{" "}
                  {dateLabel(nextActivity.starts_at, { month: "short" })} в{" "}
                  {timeLabel(nextActivity.starts_at)}
                </p>
              )}
            </div>
          )}
        </aside>
      )}
    </div>
  );
}
