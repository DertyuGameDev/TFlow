import { FLOW_DAY_HEADING, type layoutFlow } from "./flow-layout";
import { FLOW_SHORT_SLOT_HEIGHT, type FlowMarker } from "./flow-markers";

/** Enlarge only short intervals; move the ruler and every lane together. */
export function readableFlow(
  base: ReturnType<typeof layoutFlow>,
  groups: FlowMarker[],
) {
  const ranges = groups.map((group) => ({
    group,
    start: Math.min(...group.items.map((item) => item.top)),
    end: Math.max(...group.items.map((item) => item.top + item.height)),
  }));
  const raw = [
    ...new Set([
      0,
      base.height,
      ...ranges.flatMap((range) => [range.start, range.end]),
    ]),
  ].sort((a, b) => a - b);
  const projected = new Map<number, number>();
  for (let i = 0; i < raw.length; i++) {
    let top = i ? projected.get(raw[i - 1])! + raw[i] - raw[i - 1] : raw[i];
    for (const range of ranges) {
      if (range.end === raw[i])
        top = Math.max(
          top,
          projected.get(range.start)! + FLOW_SHORT_SLOT_HEIGHT,
        );
    }
    projected.set(raw[i], top);
  }
  const project = (value: number) => {
    const index = raw.findIndex((point) => point >= value);
    if (index <= 0)
      return (
        value +
        (index === 0
          ? projected.get(raw[0])! - raw[0]
          : projected.get(raw.at(-1)!)! - raw.at(-1)!)
      );
    const a = raw[index - 1],
      b = raw[index];
    return (
      projected.get(a)! +
      ((value - a) / (b - a)) * (projected.get(b)! - projected.get(a)!)
    );
  };
  const placements = base.placements.map((item) => ({
    ...item,
    top: project(item.top),
    height: project(item.top + item.height) - project(item.top),
  }));
  const byId = new Map(placements.map((item) => [item.activity.id, item]));
  const days = base.days.map((day) => {
    const start = day.top + FLOW_DAY_HEADING;
    const end = start + day.height;
    const points = [
      ...new Set([
        start,
        end,
        ...raw.filter((point) => point > start && point < end),
      ]),
    ]
      .sort((a, b) => a - b)
      .map((point) => ({
        time:
          day.start + ((point - start) / day.height) * (day.end - day.start),
        top: project(point),
      }));
    return {
      ...day,
      top: project(day.top),
      height: project(end) - project(start),
      points,
      ticks: day.ticks.map((tick) => ({ ...tick, top: project(tick.top) })),
      gaps: day.gaps.map((gap) => ({
        ...gap,
        top: project(gap.top),
        height: project(gap.top + gap.height) - project(gap.top),
      })),
    };
  });
  return {
    layout: { ...base, placements, days, height: project(base.height) },
    markers: ranges.map(({ group, start, end }) => ({
      ...group,
      first: project(group.first),
      last: project(group.last),
      items: group.items.map((item) => byId.get(item.activity.id)!),
      top: project(start) + 4,
      height: Math.max(0, project(end) - project(start) - 8),
    })),
  };
}
