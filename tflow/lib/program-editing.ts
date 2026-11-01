import type { Activity } from "./types";

export type ProgramRange = {
  starts_at: number;
  ends_at: number;
  room_id?: string;
};
export type ProgramEdge = "start" | "end";
export const PROGRAM_MINUTE = 60000;
export const NEW_ONLINE_ROOM = "@new-online";

export function moveProgramRange(
  activity: ProgramRange,
  delta: number,
  start: number,
  end: number,
): ProgramRange {
  const duration = activity.ends_at - activity.starts_at;
  const from = Math.max(start, Math.min(end - duration, activity.starts_at + delta));
  return { starts_at: from, ends_at: from + duration };
}

export function timelineTimeAt(
  clientX: number,
  left: number,
  width: number,
  start: number,
  end: number,
  step: number,
) {
  const value = start + ((clientX - left) / Math.max(1, width)) * (end - start);
  return Math.max(start, Math.min(end, Math.round(value / step) * step));
}

export function createProgramRange(
  anchor: number,
  cursor: number,
  start: number,
  end: number,
  click = false,
): ProgramRange {
  const minimum = Math.min(PROGRAM_MINUTE, end - start);
  const from = Math.max(
    start,
    Math.min(end - minimum, Math.min(anchor, cursor)),
  );
  const to = Math.min(
    end,
    Math.max(
      from + minimum,
      click ? from + 30 * PROGRAM_MINUTE : Math.max(anchor, cursor),
    ),
  );
  return { starts_at: from, ends_at: to };
}

export function resizeProgramRange(
  activity: ProgramRange,
  edge: ProgramEdge,
  value: number,
  start: number,
  end: number,
): ProgramRange {
  const minimum = Math.min(
    PROGRAM_MINUTE,
    activity.ends_at - activity.starts_at,
    end - start,
  );
  return edge === "start"
    ? {
        starts_at: Math.max(start, Math.min(value, activity.ends_at - minimum)),
        ends_at: activity.ends_at,
      }
    : {
        starts_at: activity.starts_at,
        ends_at: Math.min(end, Math.max(value, activity.starts_at + minimum)),
      };
}

export function programRangeConflict(
  activity: Activity,
  range: ProgramRange,
  activities: Activity[],
) {
  return activities.find(
    (other) =>
      other.id !== activity.id &&
      other.room_id === activity.room_id &&
      other.starts_at < range.ends_at &&
      other.ends_at > range.starts_at,
  );
}
