import type { FlowEvent } from "./types";

export const webinarPath = (eventId: string, activityId?: string) =>
  `#webinar/${encodeURIComponent(eventId)}${activityId ? `/${encodeURIComponent(activityId)}` : ""}`;

export const hasWebinar = (event: FlowEvent) =>
  event.format === "Онлайн" || event.format === "Гибрид";

export const canEnterWebinar = (
  event: FlowEvent,
  userId: string | undefined,
  now = Date.now(),
) =>
  hasWebinar(event) &&
  event.status === "published" &&
  event.ends_at > now &&
  !!userId &&
  (event.enrolled > 0 || event.owner_id === userId);
