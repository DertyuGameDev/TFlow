import type { Activity } from "./types";

export function activityAvailability(activity: Activity, schedule: Activity[], now: number) {
  const registered = Boolean(activity.registered);
  const free = Math.max(0, activity.capacity - activity.taken);
  const closed = activity.starts_at <= now;
  const conflict = !registered ? schedule.find(other => other.id !== activity.id
    && other.starts_at < activity.ends_at && other.ends_at > activity.starts_at) : undefined;
  return { registered, free, closed, conflict, blocked: !registered && (closed || free === 0 || Boolean(conflict)) };
}
