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
  return day
    ? day.start + ((offset - day.top - FLOW_DAY_HEADING) / scale) * FLOW_MINUTE
    : null;
}

export function flowOffsetAtTime(days: FlowDay[], time: number, scale: number) {
  const day = days.find((day) => day.end >= time) ?? days.at(-1);
  return day
    ? day.top + FLOW_DAY_HEADING + ((time - day.start) / FLOW_MINUTE) * scale
    : 0;
}
