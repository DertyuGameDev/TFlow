import { describe, expect, it } from "vitest";
import { flowDuration, layoutFlow } from "../lib/flow-layout";
import type { Activity } from "../lib/types";
import { event } from "./fixtures";

function activity(id: string, start: number, duration: number) {
  return {
    id,
    title: id,
    room_id: id,
    starts_at: event.starts_at + start * 60000,
    ends_at: event.starts_at + (start + duration) * 60000,
  } as Activity;
}
describe("геометрия флоу по времени", () => {
  it.each([2, 8, 64])(
    "показывает час в 12 раз длиннее пяти минут и сохраняет десятиминутный перерыв при масштабе %s",
    (scale) => {
      const layout = layoutFlow(
        [activity("five", 0, 5), activity("hour", 15, 60)],
        scale,
      );
      const [five, hour] = layout.placements;
      expect(hour.height / five.height).toBe(12);
      expect(hour.top - five.top - five.height).toBe(10 * scale);
      expect(layout.days[0].gaps[0].end - layout.days[0].gaps[0].start).toBe(
        10 * 60000,
      );
    },
  );
  it("располагает пересечения рядом и возвращает полную ширину после них", () => {
    const { placements } = layoutFlow(
      [
        activity("long", 0, 60),
        activity("parallel", 15, 30),
        activity("next", 60, 20),
      ],
      8,
    );
    const [long, parallel, next] = placements;
    expect(long.lanes).toBe(2);
    expect(parallel.lane).not.toBe(long.lane);
    expect(parallel.top - long.top).toBe(15 * 8);
    expect(next.lanes).toBe(1);
    expect(next.lane).toBe(0);
  });
  it("не меняет исходный массив при сортировке и масштабировании", () => {
    const items = [activity("later", 30, 5), activity("early", 0, 5)];
    layoutFlow(items, 8);
    expect(items.map((item) => item.id)).toEqual(["later", "early"]);
    expect(layoutFlow(items, 16).placements[1].height).toBe(80);
  });
  it("оставляет пересекающиеся активности через полночь на общей шкале", () => {
    const first = activity("night", 0, 120);
    first.starts_at = Date.parse("2026-11-01T23:30:00+03:00");
    first.ends_at = Date.parse("2026-11-02T01:30:00+03:00");
    const second = {
      ...first,
      id: "after-midnight",
      starts_at: Date.parse("2026-11-02T00:00:00+03:00"),
      ends_at: Date.parse("2026-11-02T01:00:00+03:00"),
    };
    const result = layoutFlow([first, second], 4);
    expect(result.days).toHaveLength(1);
    expect(result.placements[1].top - result.placements[0].top).toBe(30 * 4);
    expect(result.placements.map((item) => item.lane)).toEqual([0, 1]);
  });
  it("подписывает длительности без округления часа до пяти минут", () => {
    expect(flowDuration(5 * 60000)).toBe("5 мин");
    expect(flowDuration(60 * 60000)).toBe("1 ч");
    expect(flowDuration(75 * 60000)).toBe("1 ч 15 мин");
  });
});
