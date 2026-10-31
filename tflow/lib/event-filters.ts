import type { FlowEvent } from "./types";
export type EventTimeFilter = "all" | "active" | "past";
export function matchesEventTime(event: Pick<FlowEvent, "ends_at" | "status">, filter: EventTimeFilter, now = Date.now()) {
  if (filter === "all") return true;
  if (filter === "active") return event.status === "published" && event.ends_at > now;
  return event.status === "published" && event.ends_at <= now;
}
