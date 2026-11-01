import type { Activity } from "./types";
import { dateKey } from "./time";

export const FLOW_MINUTE = 60_000;
export const FLOW_DAY_HEADING = 58;
export type FlowRange = { starts_at: number; ends_at: number };
export type FlowPlacement = {
  activity: Activity;
  top: number;
  height: number;
  lane: number;
  lanes: number;
  span: number;
};
export type FlowDay = {
  key: string;
  start: number;
  end: number;
  top: number;
  height: number;
  ticks: { time: number; top: number }[];
  gaps: { start: number; end: number; top: number; height: number }[];
  points?: { time: number; top: number }[];
};

export function flowDuration(milliseconds: number) {
  const minutes = Math.max(1, Math.round(milliseconds / FLOW_MINUTE));
  const hours = Math.floor(minutes / 60),
    rest = minutes % 60;
  return hours ? `${hours} ч${rest ? ` ${rest} мин` : ""}` : `${minutes} мин`;
}

export function layoutFlow(
  activities: Activity[],
  pixelsPerMinute: number,
  range?: FlowRange,
) {
  const scale = Math.max(1, pixelsPerMinute);
  const items = [...activities].sort(
    (a, b) =>
      a.starts_at - b.starts_at ||
      a.ends_at - b.ends_at ||
      a.id.localeCompare(b.id),
  );
  const grouped = new Map<string, Activity[]>();
  let windowKey = "",
    windowEnd = -Infinity;
  for (const item of items) {
    const key = dateKey(item.starts_at);
    if (!windowKey || (key !== windowKey && item.starts_at >= windowEnd)) {
      windowKey = key;
      windowEnd = item.ends_at;
    }
    windowEnd = Math.max(windowEnd, item.ends_at);
    const group = grouped.get(windowKey) ?? [];
    group.push(item);
    grouped.set(windowKey, group);
  }
  const bounded =
    range && Number.isFinite(range.starts_at) &&
    Number.isFinite(range.ends_at) && range.ends_at > range.starts_at
      ? range
      : undefined;
  // Event timelines keep one continuous interval, including empty days and nights.
  if (bounded) {
    grouped.clear();
    grouped.set(
      dateKey(Math.min(bounded.starts_at, items[0]?.starts_at ?? bounded.starts_at)),
      items,
    );
  }
  const placements: FlowPlacement[] = [],
    days: FlowDay[] = [];
  let offset = 0,
    maximumLanes = 1;
  for (const [key, group] of grouped) {
    const start = bounded
      ? Math.min(bounded.starts_at, group[0]?.starts_at ?? bounded.starts_at)
      : group[0].starts_at;
    const end = Math.max(
      ...group.map((item) => item.ends_at),
      bounded?.ends_at ?? start + FLOW_MINUTE,
    );
    const windowScale = bounded
      ? Math.max(scale, 32 / ((end - start) / FLOW_MINUTE))
      : scale;
    const height = ((end - start) / FLOW_MINUTE) * windowScale;
    const top = offset + FLOW_DAY_HEADING;
    const toY = (time: number) => top + ((time - start) / FLOW_MINUTE) * windowScale;
    const tickMinutes =
      scale >= 32 ? 1 : scale >= 12 ? 5 : scale >= 4 ? 15 : 30;
    const ticks: FlowDay["ticks"] = [{ time: start, top: toY(start) }];
    for (
      let time =
        Math.ceil(start / (tickMinutes * FLOW_MINUTE)) *
        tickMinutes *
        FLOW_MINUTE;
      time < end;
      time += tickMinutes * FLOW_MINUTE
    ) {
      if (time - ticks.at(-1)!.time < (24 / windowScale) * FLOW_MINUTE) continue;
      ticks.push({ time, top: toY(time) });
    }
    if (
      end - ticks.at(-1)!.time < (24 / windowScale) * FLOW_MINUTE &&
      ticks.length > 1
    )
      ticks.pop();
    if (ticks.at(-1)?.time !== end) ticks.push({ time: end, top: toY(end) });
    const gaps: FlowDay["gaps"] = [];
    let cursor = start;
    for (const item of group) {
      if (item.starts_at - cursor >= 5 * FLOW_MINUTE)
        gaps.push({
          start: cursor,
          end: item.starts_at,
          top: toY(cursor),
          height: ((item.starts_at - cursor) / FLOW_MINUTE) * windowScale,
        });
      cursor = Math.max(cursor, item.ends_at);
    }
    if (end - cursor >= 5 * FLOW_MINUTE)
      gaps.push({
        start: cursor,
        end,
        top: toY(cursor),
        height: ((end - cursor) / FLOW_MINUTE) * windowScale,
      });
    days.push({ key, start, end, top: offset, height, ticks, gaps });
    let cluster: Activity[] = [],
      clusterEnd = -Infinity;
    function placeCluster() {
      if (!cluster.length) return;
      const ends: number[] = [];
      const positioned = cluster.map((activity) => {
        let lane = ends.findIndex((value) => value <= activity.starts_at);
        if (lane < 0) lane = ends.length;
        ends[lane] = activity.ends_at;
        return {
          activity,
          lane,
          lanes: 0,
          span: 1,
          top: toY(activity.starts_at),
          height: Math.max(
            1,
            ((activity.ends_at - activity.starts_at) / FLOW_MINUTE) * windowScale,
          ),
        };
      });
      maximumLanes = Math.max(maximumLanes, ends.length);
      for (const placement of positioned) {
        placement.lanes = ends.length;
        for (let lane = placement.lane + 1; lane < ends.length; lane++) {
          if (
            positioned.some(
              (other) =>
                other.lane === lane &&
                other.activity.starts_at < placement.activity.ends_at &&
                other.activity.ends_at > placement.activity.starts_at,
            )
          )
            break;
          placement.span++;
        }
        placements.push(placement);
      }
      cluster = [];
    }
    for (const activity of group) {
      if (activity.starts_at >= clusterEnd) placeCluster();
      cluster.push(activity);
      clusterEnd = Math.max(
        cluster.length === 1 ? activity.ends_at : clusterEnd,
        activity.ends_at,
      );
    }
    placeCluster();
    offset = top + height + 46;
  }
  return { placements, days, height: Math.max(0, offset), maximumLanes };
}
