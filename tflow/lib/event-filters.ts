import type { FlowEvent } from "./types";
export type EventTimeFilter = "all" | "active" | "past" | "now";
export function matchesEventTime(event: Pick<FlowEvent, "starts_at" | "ends_at" | "status" | "checked_in">, filter: EventTimeFilter, now = Date.now()) {
  if (filter === "all") return true;
  if (filter === "now") return event.status === "published" && event.starts_at <= now && now < event.ends_at;
  if (filter === "active") return event.status === "published" && event.ends_at > now;
  return event.status === "published" && event.ends_at <= now;
}

// Attendance is a personal mark on completed events, independent of a ticket.
export function isAttendedPastEvent(event: Pick<FlowEvent, "starts_at" | "ends_at" | "status" | "checked_in">, now = Date.now()) {
  return matchesEventTime(event, "past", now) && !!event.checked_in;
}
