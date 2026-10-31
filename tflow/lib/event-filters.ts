import type { FlowEvent } from "./types";
export type EventTimeFilter = "all" | "active" | "past" | "now" | "visited";
export function matchesEventTime(event: Pick<FlowEvent, "starts_at" | "ends_at" | "status" | "checked_in">, filter: EventTimeFilter, now = Date.now()) {
  if (filter === "all") return true;
  if (filter === "now") return event.status === "published" && event.starts_at <= now && now < event.ends_at;
  if (filter === "visited") return event.status === "published" && !!event.checked_in;
  if (filter === "active") return event.status === "published" && event.ends_at > now;
  return event.status === "published" && event.ends_at <= now;
}
