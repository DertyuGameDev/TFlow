import type { Bootstrap } from "./types";

export const DAY_MS = 86_400_000;
export const MINUTE_MS = 60_000;
const MOSCOW_OFFSET = 3 * 60 * MINUTE_MS;

export type CalendarSource = "ticket" | "activity" | "owned";
export type CalendarEntry = {
  id: string;
  eventId: string;
  title: string;
  starts_at: number;
  ends_at: number;
  source: CalendarSource;
  location: string;
  description: string;
  eventTitle?: string;
  activityId?: string;
  capacity: number;
  taken: number;
  draft: boolean;
};
export type DaySegment = {
  entry: CalendarEntry;
  startMinute: number;
  endMinute: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
};
export type PositionedSegment = DaySegment & { column: number; columns: number; displayEnd: number };

/** Calendar dates are always Moscow dates, independent of the browser timezone. */
export function calendarDate(timestamp: number) {
  return new Date(timestamp + MOSCOW_OFFSET).toISOString().split("T")[0];
}

export function dayStart(date: string) {
  return Date.parse(`${date}T00:00:00+03:00`);
}

export function isCalendarDate(value?: string): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = dayStart(value);
  return Number.isFinite(timestamp) && calendarDate(timestamp) === value && value >= "1900-01-01" && value <= "9999-12-31";
}

export function shiftDays(date: string, amount: number) {
  const candidate = calendarDate(dayStart(date) + amount * DAY_MS);
  return isCalendarDate(candidate) ? candidate : date;
}

export function shiftMonths(date: string, amount: number) {
  const [year, month, day] = date.split("-").map(Number);
  const first = new Date(Date.UTC(year, month - 1 + amount, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(day, lastDay));
  const candidate = first.toISOString().split("T")[0];
  return isCalendarDate(candidate) ? candidate : date;
}

export function monthDays(date: string): string[] {
  const first = `${date.slice(0, 7)}-01`;
  const weekday = new Date(dayStart(first) + MOSCOW_OFFSET).getUTCDay();
  const offset = (weekday + 6) % 7;
  const nextMonth = shiftMonths(first, 1);
  const count = nextMonth === first ? 31 : Math.round((dayStart(nextMonth) - dayStart(first)) / DAY_MS);
  const cells = Math.ceil((offset + count) / 7) * 7;
  return Array.from({ length: cells }, (_, index) => calendarDate(dayStart(first) + (index - offset) * DAY_MS));
}

export function calendarEntries(data: Bootstrap, userId: string): CalendarEntry[] {
  const own = data.events.filter(event => event.owner_id === userId);
  const ownedIds = new Set(own.map(event => event.id));
  const events = [...data.tickets.filter(event => !ownedIds.has(event.id)).map(event => ({ event, source: "ticket" as const })),
    ...own.map(event => ({ event, source: "owned" as const }))];
  const entries: CalendarEntry[] = events.map(({ event, source }) => ({
    id: `event:${event.id}`, eventId: event.id, title: event.title,
    starts_at: event.starts_at, ends_at: event.ends_at, source,
    location: [event.city, event.venue].filter(Boolean).join(" · "),
    description: event.description, draft: event.status === "draft",
    capacity: event.capacity, taken: event.participant_count,
  }));
  entries.push(...data.schedule.map(activity => ({
    id: `activity:${activity.id}`, eventId: activity.event_id, title: activity.title,
    starts_at: activity.starts_at, ends_at: activity.ends_at, source: "activity" as const,
    location: activity.room_name, description: activity.description,
    eventTitle: activity.event_title, activityId: activity.id, draft: false,
    capacity: activity.capacity, taken: activity.taken,
  })));
  return entries.filter(entry => Number.isFinite(entry.starts_at) && Number.isFinite(entry.ends_at) && entry.ends_at > entry.starts_at)
    .sort((a, b) => a.starts_at - b.starts_at || a.title.localeCompare(b.title, "ru") || a.id.localeCompare(b.id));
}

export function entriesForDay(entries: CalendarEntry[], date: string): DaySegment[] {
  const start = dayStart(date);
  const end = start + DAY_MS;
  return entries.filter(entry => entry.starts_at < end && entry.ends_at > start).map(entry => ({
    entry,
    startMinute: Math.max(0, (entry.starts_at - start) / MINUTE_MS),
    endMinute: Math.min(1440, (entry.ends_at - start) / MINUTE_MS),
    continuesBefore: entry.starts_at < start,
    continuesAfter: entry.ends_at > end,
  }));
}

/** Greedy interval partitioning keeps simultaneous entries in separate columns.
 * Short entries reserve 30 visible minutes so their labels cannot cover each other. */
export function positionDayEntries(segments: DaySegment[]): PositionedSegment[] {
  const sorted = [...segments].sort((a, b) => a.startMinute - b.startMinute || b.endMinute - a.endMinute || a.entry.id.localeCompare(b.entry.id));
  const result: PositionedSegment[] = [];
  let group: PositionedSegment[] = [];
  let laneEnds: number[] = [];
  let groupEnd = 0;
  function finishGroup() {
    for (const segment of group) segment.columns = laneEnds.length;
    result.push(...group);
    group = [];
    laneEnds = [];
  }
  for (const segment of sorted) {
    if (group.length && segment.startMinute >= groupEnd) finishGroup();
    if (!group.length) groupEnd = 0;
    const displayEnd = Math.min(1440, Math.max(segment.endMinute, segment.startMinute + 30));
    let column = laneEnds.findIndex(end => end <= segment.startMinute);
    if (column === -1) column = laneEnds.length;
    laneEnds[column] = displayEnd;
    groupEnd = Math.max(groupEnd, displayEnd);
    group.push({ ...segment, column, columns: 1, displayEnd });
  }
  finishGroup();
  return result;
}
