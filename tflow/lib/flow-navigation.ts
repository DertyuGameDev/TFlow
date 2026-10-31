import { FLOW_DAY_HEADING, FLOW_MINUTE, type FlowDay } from "./flow-layout";

export const FLOW_PAGE_SCROLL_QUERY =
  "(max-width: 760px), (pointer: coarse), (max-width: 1100px) and (max-height: 500px)";

export function flowTimeAtOffset(
  days: FlowDay[],
  offset: number,
  scale: number,
) {
  const day =
    days.find((day) => day.top + FLOW_DAY_HEADING + day.height >= offset) ??
    days.at(-1);
  if (day?.points?.length) {
    const points = day.points;
    const index = points.findIndex((point) => point.top >= offset);
    if (index <= 0) {
      const point = index === 0 ? points[0] : points.at(-1)!;
      return point.time + ((offset - point.top) / scale) * FLOW_MINUTE;
    }
    const a = points[index - 1],
      b = points[index];
    return a.time + ((offset - a.top) / (b.top - a.top)) * (b.time - a.time);
  }
  return day
    ? day.start + ((offset - day.top - FLOW_DAY_HEADING) / scale) * FLOW_MINUTE
    : null;
}

export function flowOffsetAtTime(days: FlowDay[], time: number, scale: number) {
  const day = days.find((day) => day.end >= time) ?? days.at(-1);
  if (day?.points?.length) {
    const points = day.points;
    const index = points.findIndex((point) => point.time >= time);
    if (index <= 0) {
      const point = index === 0 ? points[0] : points.at(-1)!;
      return point.top + ((time - point.time) / FLOW_MINUTE) * scale;
    }
    const a = points[index - 1],
      b = points[index];
    return a.top + ((time - a.time) / (b.time - a.time)) * (b.top - a.top);
  }
  return day
    ? day.top + FLOW_DAY_HEADING + ((time - day.start) / FLOW_MINUTE) * scale
    : 0;
}
