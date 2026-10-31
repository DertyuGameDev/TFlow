import { describe, expect, it } from "vitest";
import { isAttendedPastEvent, matchesEventTime } from "../lib/event-filters";
import { event } from "./fixtures";

describe("состояния мероприятий", () => {
  it("считает событие идущим только в полуоткрытом интервале расписания", () => {
    expect(matchesEventTime(event, "now", event.starts_at - 1)).toBe(false);
    expect(matchesEventTime(event, "now", event.starts_at)).toBe(true);
    expect(matchesEventTime(event, "now", event.ends_at - 1)).toBe(true);
    expect(matchesEventTime(event, "now", event.ends_at)).toBe(false);
    expect(matchesEventTime({...event, status: "draft"}, "now", event.starts_at)).toBe(false);
  });
  it("не подменяет посещение регистрацией или окончанием события", () => {
    const registered = {...event, enrolled: 1};
    expect(isAttendedPastEvent(registered, event.ends_at + 1)).toBe(false);
    expect(isAttendedPastEvent({...event, checked_in: 1}, event.starts_at)).toBe(false);
    expect(isAttendedPastEvent({...event, checked_in: 1}, event.ends_at)).toBe(true);
    expect(isAttendedPastEvent({...event, checked_in: 1, status:"draft"}, event.ends_at + 1)).toBe(false);
  });
  it("включает текущие и будущие опубликованные события в активные", () => {
    expect(matchesEventTime(event, "active", event.starts_at - 1)).toBe(true);
    expect(matchesEventTime(event, "active", event.starts_at + 1)).toBe(true);
    expect(matchesEventTime(event, "active", event.ends_at)).toBe(false);
    expect(matchesEventTime(event, "past", event.ends_at)).toBe(true);
  });
  it("показывает черновики только в общем списке", () => {
    const draft = { ...event, status: "draft" as const };
    expect(matchesEventTime(draft, "all", event.ends_at)).toBe(true);
    expect(matchesEventTime(draft, "active", event.starts_at)).toBe(false);
    expect(matchesEventTime(draft, "past", event.ends_at)).toBe(false);
  });
});
