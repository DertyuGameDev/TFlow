import { describe, expect, it } from "vitest";
import { FLOW_DAY_HEADING, flowDuration, layoutFlow } from "../lib/flow-layout";
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
  it.each([3, 8, 32])("сохраняет весь интервал мероприятия и пустое время по краям при масштабе %s", scale => {
    const middle = activity("middle", 30, 30);
    const result = layoutFlow([middle], scale, event);
    const [window] = result.days;
    expect(window.start).toBe(event.starts_at);
    expect(window.end).toBe(event.ends_at);
    expect(window.ticks[0].time).toBe(event.starts_at);
    expect(window.ticks.at(-1)!.time).toBe(event.ends_at);
    expect(result.placements[0].top - FLOW_DAY_HEADING).toBe(30 * scale);
    expect(window.gaps.map(gap => [gap.start, gap.end])).toEqual([
      [event.starts_at, middle.starts_at], [middle.ends_at, event.ends_at],
    ]);
  });

  it("сохраняет границы и без активностей, в том числе при коротком мероприятии", () => {
    const full = layoutFlow([], 3, event);
    expect(full.days[0].start).toBe(event.starts_at);
    expect(full.days[0].end).toBe(event.ends_at);
    expect(full.days[0].gaps).toHaveLength(1);
    expect(full.placements).toEqual([]);
    const short = layoutFlow([], 3, { ...event, ends_at: event.starts_at + 60_000 });
    expect(short.days[0].ticks[1].top - short.days[0].ticks[0].top).toBeGreaterThanOrEqual(24);
  });

  it("показывает непрерывно пустые дни и пересечения через полночь внутри мероприятия", () => {
    const range = { starts_at: Date.parse("2026-11-01T09:00:00+03:00"), ends_at: Date.parse("2026-11-04T18:00:00+03:00") };
    const night = { ...activity("night", 0, 60), starts_at: Date.parse("2026-11-01T23:30:00+03:00"), ends_at: Date.parse("2026-11-02T01:00:00+03:00") };
    const parallel = { ...night, id: "parallel", starts_at: Date.parse("2026-11-02T00:00:00+03:00") };
    const result = layoutFlow([night, parallel], 3, range);
    expect(result.days).toHaveLength(1);
    expect(result.days[0].start).toBe(range.starts_at);
    expect(result.days[0].end).toBe(range.ends_at);
    expect(result.placements[1].top - result.placements[0].top).toBe(30 * 3);
    expect(result.placements.map(item => item.lane)).toEqual([0, 1]);
    expect(result.days[0].ticks.some(tick => tick.time === Date.parse("2026-11-03T00:00:00+03:00"))).toBe(true);
  });

  it("не теряет существующие активности вне границ и игнорирует некорректный интервал", () => {
    const outside = activity("early", -30, 180);
    const result = layoutFlow([outside], 3, event);
    expect(result.days[0].start).toBe(outside.starts_at);
    expect(result.days[0].end).toBe(outside.ends_at);
    expect(layoutFlow([outside], 3, { starts_at: NaN, ends_at: 0 })).toEqual(layoutFlow([outside], 3));
  });

  it.each([3, 8, 32])(
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
  it("начинает шкалу с первой активности, не добавляя выдуманный перерыв", () => {
    const first = activity("first", 12, 60);
    const second = activity("second", 72, 60);
    const { days, placements } = layoutFlow([first, second], 3);
    expect(days[0].start).toBe(first.starts_at);
    expect(days[0].end).toBe(second.ends_at);
    expect(days[0].height).toBe(360);
    expect(days[0].gaps).toEqual([]);
    expect(placements[0].top).toBe(days[0].top + FLOW_DAY_HEADING);
    const ticks = days[0].ticks;
    expect(ticks[0].time).toBe(first.starts_at);
    expect(ticks.at(-1)!.time).toBe(second.ends_at);
    for (let i = 1; i < ticks.length; i++) {
      expect(ticks[i].top - ticks[i - 1].top).toBeGreaterThanOrEqual(24);
    }
  });
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
