import { describe, expect, it } from "vitest";
import { layoutFlow, FLOW_DAY_HEADING } from "../lib/flow-layout";
import { flowTimeAtOffset, flowOffsetAtTime } from "../lib/flow-navigation";
import type { Activity } from "../lib/types";

const start = Date.parse("2026-11-01T10:00:00+03:00");
const activities = [0, 1].map((day) => ({
  id: String(day),
  room_id: "room",
  starts_at: start + day * 86400000,
  ends_at: start + day * 86400000 + 3 * 3600000,
})) as Activity[];

describe("сохранение видимого времени при масштабе флоу", () => {
  it.each([0, 1])(
    "возвращает то же время после увеличения и уменьшения на дне %s",
    (day) => {
      const small = layoutFlow(activities, 3);
      const large = layoutFlow(activities, 12);
      const time = activities[day].starts_at + 73 * 60000;
      const anchor = flowTimeAtOffset(
        small.days,
        flowOffsetAtTime(small.days, time, 3),
        3,
      )!;
      expect(anchor).toBe(time);
      expect(
        flowTimeAtOffset(
          large.days,
          flowOffsetAtTime(large.days, anchor, 12),
          12,
        ),
      ).toBe(time);
    },
  );
  it("сохраняет позицию первого заголовка и обрабатывает пустую программу", () => {
    const small = layoutFlow(activities, 3);
    expect(flowOffsetAtTime(small.days, start, 3)).toBe(FLOW_DAY_HEADING);
    expect(flowTimeAtOffset([], 100, 3)).toBeNull();
    expect(flowOffsetAtTime([], start, 3)).toBe(0);
  });
});
