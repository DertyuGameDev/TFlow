import type { FlowEvent } from "./types";

export function splitOrganizerEvents(
  events: readonly FlowEvent[],
  now = Date.now(),
) {
  const upcoming: FlowEvent[] = [],
    archive: FlowEvent[] = [];
  for (const event of events) {
    (event.ends_at <= now ? archive : upcoming).push(event);
  }
  upcoming.sort(
    (a, b) => a.starts_at - b.starts_at || a.id.localeCompare(b.id),
  );
  archive.sort(
    (a, b) =>
      b.ends_at - a.ends_at ||
      b.starts_at - a.starts_at ||
      a.id.localeCompare(b.id),
  );
  return { upcoming, archive };
}
