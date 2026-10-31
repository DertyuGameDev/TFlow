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
