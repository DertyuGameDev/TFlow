import { useEffect, useMemo, useState, type ReactNode } from "react";
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

const COLORS = ["#d3a817", "#6098e5", "#51a28b", "#a080d4", "#df906f"];
function colorFor(room: string) {
  let hash = 0;
  for (const char of room) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return COLORS[hash % COLORS.length];
}

export function FlowSchedule({
  activities,
  now,
  renderActivity,
  selectedId,
  label = "Флоу мероприятия",
}: {
  activities: Activity[];
  now: number;
  renderActivity: (activity: Activity) => ReactNode;
  selectedId?: string;
  label?: string;
}) {
  const items = useMemo(
    () =>
      [...activities].sort(
        (a, b) =>
          a.starts_at - b.starts_at ||
          a.ends_at - b.ends_at ||
          a.id.localeCompare(b.id),
      ),
    [activities],
  );
  return (
    <ol className="vertical-flow" aria-label={label}>
      {items.map((item, index) => {
        const live = item.starts_at <= now && now < item.ends_at;
        const past = item.ends_at <= now;
        const firstDay =
          index === 0 ||
          dateKey(items[index - 1].starts_at) !== dateKey(item.starts_at);
        const progress = live
          ? Math.min(
              100,
              Math.max(
                0,
                ((now - item.starts_at) / (item.ends_at - item.starts_at)) *
                  100,
              ),
            )
          : 0;
        return (
          <li
            key={item.id}
            className={`flow-step ${live ? "is-live" : ""} ${past ? "is-past" : ""}`}
          >
            {firstDay && (
              <h3 className="flow-date">
                {dateLabel(item.starts_at, {
                  weekday: "long",
                  year: "numeric",
                })}
              </h3>
            )}
            <div
              className="flow-step-row"
              style={
                {
                  "--flow-color": colorFor(item.room_id),
                } as React.CSSProperties
              }
            >
              <time
                className="flow-axis-time"
                dateTime={new Date(item.starts_at).toISOString()}
              >
                {timeLabel(item.starts_at)}
              </time>
              <span className="flow-stem" aria-hidden="true">
                <i />
              </span>
              <div
                className={`flow-block ${selectedId === item.id ? "is-selected" : ""}`}
                aria-current={live ? "step" : undefined}
                data-activity-id={item.id}
              >
                {live && (
                  <div className="flow-live-label">
                    <i aria-hidden="true" />
                    Сейчас · до {timeLabel(item.ends_at)}
                  </div>
                )}
                {renderActivity(item)}
                {live && (
                  <div className="flow-live-progress" aria-hidden="true">
                    <i style={{ width: `${progress}%` }} />
                  </div>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
