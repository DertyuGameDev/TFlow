import type { Activity } from "./types";
import { dateKey } from "./time";

export const PROGRAM_COLORS = [
  "#ffd54f",
  "#8dbdff",
  "#8bdbb5",
  "#d4a4f5",
  "#ffad96",
  "#83d5e7",
  "#e4c48a",
  "#c2d989",
  "#f3a9cd",
  "#b5b3ff",
] as const;

export type TimelineSegment = {
  id: string;
  items: Activity[];
  start: number;
  end: number;
};
export type TimelineTrack = {
  id: string;
  name: string;
  segments: TimelineSegment[];
};

export type ProjectedSegment = {
  segment: TimelineSegment;
  roomName: string;
  roomKey: string;
  side: "above" | "below";
  row: number;
  left: number;
  right: number;
  labelLeft: number;
  labelWidth: number;
};

/** Place ranges around one axis. At most two bands on each side keep the overview compact. */
export function projectProgramTracks(
  tracks: TimelineTrack[],
  start: number,
  end: number,
  width: number,
) {
  const placed: ProjectedSegment[] = [];
  const geometry = (segment: TimelineSegment) => {
    const left = ((segment.start - start) * width) / (end - start);
    const right = ((segment.end - start) * width) / (end - start);
    const labelWidth = Math.min(
      width,
      Math.max(width < 500 ? 96 : 132, Math.min(220, right - left)),
    );
    const labelLeft = Math.max(
      0,
      Math.min(width - labelWidth, (left + right - labelWidth) / 2),
    );
    return { left, right, labelLeft, labelWidth };
  };
  const occupied = (node: ProjectedSegment) => ({
    left: Math.min(node.left, node.labelLeft),
    right: Math.max(node.right, node.labelLeft + node.labelWidth),
  });
  const collides = (a: ProjectedSegment, b: ProjectedSegment) => {
    const x = occupied(a),
      y = occupied(b);
    return x.left < y.right + 10 && y.left < x.right + 10;
  };
  const candidates = tracks
    .flatMap((track) =>
      track.segments.map((segment) => ({
        segment: { ...segment, items: [...segment.items] },
        roomName: track.name,
        roomKey: track.id,
      })),
    )
    .sort(
      (a, b) =>
        a.segment.start - b.segment.start ||
        a.segment.end - b.segment.end ||
        a.segment.id.localeCompare(b.segment.id),
    );
  candidates.forEach((candidate, index) => {
    const preferred = index % 2 === 0 ? "above" : "below";
    const other = preferred === "above" ? "below" : "above";
    const node: ProjectedSegment = {
      ...candidate,
      ...geometry(candidate.segment),
      side: preferred,
      row: 0,
    };
    for (const [side, row] of [
      [preferred, 0],
      [other, 0],
      [preferred, 1],
      [other, 1],
    ] as const) {
      if (
        !placed.some(
          (existing) =>
            existing.side === side &&
            existing.row === row &&
            collides(node, existing),
        )
      ) {
        node.side = side;
        node.row = row;
        placed.push(node);
        return;
      }
    }
    // More simultaneous ranges than the four bands can display: combine the nearest group.
    const target = placed.reduce((best, current) =>
      Math.abs(current.left + current.right - node.left - node.right) <
      Math.abs(best.left + best.right - node.left - node.right)
        ? current
        : best,
    );
    const absorb = (source: ProjectedSegment) => {
      for (const item of source.segment.items) target.segment.items.push(item);
      target.segment.start = Math.min(
        target.segment.start,
        source.segment.start,
      );
      target.segment.end = Math.max(target.segment.end, source.segment.end);
      Object.assign(target, geometry(target.segment));
    };
    absorb(node);
    // A growing group may reach its next neighbour in the same band.
    let neighbour: ProjectedSegment | undefined;
    while (
      (neighbour = placed.find(
        (existing) =>
          existing !== target &&
          existing.side === target.side &&
          existing.row === target.row &&
          collides(target, existing),
      ))
    ) {
      absorb(neighbour);
      placed.splice(placed.indexOf(neighbour), 1);
    }
  });
  for (const node of placed) {
    node.segment.items.sort(
      (a, b) => a.starts_at - b.starts_at || a.id.localeCompare(b.id),
    );
    const rooms = new Map(
      node.segment.items.map((item) => [item.room_id, item.room_name]),
    );
    node.roomKey = rooms.size === 1 ? [...rooms.keys()][0] : "mixed";
    node.roomName =
      rooms.size === 1 ? [...rooms.values()][0] : "Несколько аудиторий";
  }
  return {
    nodes: placed,
    aboveRows: Math.max(
      1,
      ...placed
        .filter((node) => node.side === "above")
        .map((node) => node.row + 1),
    ),
    belowRows: Math.max(
      1,
      ...placed
        .filter((node) => node.side === "below")
        .map((node) => node.row + 1),
    ),
  };
}

export function programTimeTicks(start: number, end: number) {
  const minute = 60000;
  const moscowOffset = 180 * minute;
  const span = (end - start) / minute;
  const step =
    [1, 5, 10, 15, 30, 60, 120, 180, 360, 720].find(
      (value) => value >= span / 4,
    ) ?? 1440;
  const ticks = [start];
  for (
    let value =
      Math.ceil((start + moscowOffset) / (step * minute)) * step * minute -
      moscowOffset;
    value < end;
    value += step * minute
  ) {
    if (
      value - start >= (end - start) * 0.1 &&
      end - value >= (end - start) * 0.1
    )
      ticks.push(value);
  }
  ticks.push(end);
  return ticks;
}

export function programDayRange(day: string, start: number, end: number) {
  const midnight = Date.parse(`${day}T00:00:00+03:00`);
  return {
    start: Math.max(start, midnight),
    end: Math.min(end, midnight + 86400000),
  };
}

export function programDayBounds(start: number, end: number) {
  return { first: dateKey(start), last: dateKey(end - 1) };
}

export function shiftProgramDay(day: string, offset: number) {
  return dateKey(Date.parse(`${day}T12:00:00+03:00`) + offset * 86400000);
}

export function itemsInRange(items: Activity[], start: number, end: number) {
  return items
    .filter((item) => item.starts_at < end && item.ends_at > start)
    .sort(
      (a, b) =>
        a.starts_at - b.starts_at ||
        a.ends_at - b.ends_at ||
        a.id.localeCompare(b.id),
    );
}

/** Keep the full time range visible. Dense neighbours share a segment until zoomed in. */
export function buildProgramTracks(
  items: Activity[],
  start: number,
  end: number,
  width: number,
): TimelineTrack[] {
  if (end <= start || width <= 0) return [];
  const rooms = new Map<string, Activity[]>();
  for (const item of itemsInRange(items, start, end)) {
    const room = rooms.get(item.room_id) ?? [];
    room.push(item);
    rooms.set(item.room_id, room);
  }
  const minSpan = ((end - start) * 44) / width;
  return [...rooms]
    .sort(
      ([, a], [, b]) =>
        a[0].starts_at - b[0].starts_at ||
        a[0].room_name.localeCompare(b[0].room_name, "ru", { numeric: true }),
    )
    .map(([id, entries]) => {
      const segments: TimelineSegment[] = [];
      for (let index = 0; index < entries.length;) {
        const first = entries[index++];
        const segment: TimelineSegment = {
          id: first.id,
          items: [first],
          start: Math.max(start, first.starts_at),
          end: Math.min(end, first.ends_at),
        };
        // Never hide a real gap or combine across rooms. At higher zoom the same items separate.
        while (
          index < entries.length &&
          segment.end - segment.start < minSpan &&
          entries[index].starts_at <= segment.end
        ) {
          const next = entries[index++];
          segment.items.push(next);
          segment.end = Math.max(segment.end, Math.min(end, next.ends_at));
        }
        segments.push(segment);
      }
      return { id, name: entries[0].room_name, segments };
    });
}

export function programColorMap(items: Activity[]) {
  return new Map(
    [...items]
      .sort((a, b) => a.starts_at - b.starts_at || a.id.localeCompare(b.id))
      .map((item, index) => [
        item.id,
        PROGRAM_COLORS[index % PROGRAM_COLORS.length],
      ]),
  );
}

export function segmentBackground(
  segment: TimelineSegment,
  colors: Map<string, string>,
) {
  const samples = segment.items
    .slice(0, PROGRAM_COLORS.length)
    .map((item) => colors.get(item.id) ?? PROGRAM_COLORS[0]);
  if (samples.length === 1) return samples[0];
  const stops = samples.map(
    (color, index) =>
      `${color} ${(index * 100) / samples.length}% ${((index + 1) * 100) / samples.length}%`,
  );
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}
