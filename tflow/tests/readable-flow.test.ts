import { describe, expect, it } from "vitest";
import { layoutFlow } from "../lib/flow-layout";
import { flowMarkers } from "../lib/flow-markers";
import { readableFlow } from "../lib/readable-flow";
import { flowTimeAtOffset, flowOffsetAtTime } from "../lib/flow-navigation";
import type { Activity } from "../lib/types";

const start = Date.parse("2026-11-01T10:00:00+03:00");
const item = (id: string, minute: number, duration = 1) =>
  ({
    id,
    title: id,
    room_id: id,
    starts_at: start + minute * 60000,
    ends_at: start + (minute + duration) * 60000,
  }) as Activity;
const build = (items: Activity[], scale = 3) => {
  const base = layoutFlow(items, scale);
  return readableFlow(base, flowMarkers(base.placements));
};

describe("читаемые короткие интервалы без наложений", () => {
  it("выделяет минуте место на шкале и сдвигает следующий блок вместе с отметками времени", () => {
    const { layout, markers } = build([item("short", 0), item("long", 1, 60)]);
    expect(layout.placements[0].height).toBe(44);
    expect(markers[0].height).toBe(36);
    expect(markers[0].top + markers[0].height).toBeLessThanOrEqual(
      layout.placements[1].top,
    );
    expect(layout.placements[1].top - layout.placements[0].top).toBe(44);
    expect(flowOffsetAtTime(layout.days, start + 60000, 3)).toBe(
      layout.placements[1].top,
    );
  });

  it("не объединяет полную полосу с коротким параллельным пунктом следующей дорожки", () => {
    const { layout, markers } = build([
      item("first", 0),
      item("long", 1, 60),
      item("parallel", 2),
    ]);
    expect(markers).toHaveLength(2);
    const long = layout.placements.find((p) => p.activity.id === "long")!;
    expect(markers[0].top + markers[0].height).toBeLessThanOrEqual(long.top);
    expect(markers[1].left).toBeGreaterThanOrEqual(
      (long.lane + long.span) / long.lanes,
    );
  });

  it("увеличивает одновременно идущие минуты вместе, сохраняя их синхронность", () => {
    const { layout } = build([item("a", 0), item("b", 0), item("next", 1, 30)]);
    const [a, b, next] = layout.placements;
    expect(a.height).toBe(44);
    expect(b.height).toBe(44);
    expect(a.top).toBe(b.top);
    expect(next.top).toBe(a.top + 44);
  });

  it("сохраняет точное время при изменении масштаба увеличенных интервалов", () => {
    const items = [item("short", 0), item("long", 1, 60), item("night", 1440)];
    for (const scale of [3, 5, 12, 32]) {
      const { layout } = build(items, scale);
      for (const time of [
        start + 30000,
        start + 60000,
        start + 20 * 60000,
        start + 86430000,
      ]) {
        expect(
          flowTimeAtOffset(
            layout.days,
            flowOffsetAtTime(layout.days, time, scale),
            scale,
          ),
        ).toBeCloseTo(time, 2);
      }
    }
  });

  it("не растягивает длинную программу и не меняет исходную геометрию", () => {
    const base = layoutFlow(
      Array.from({ length: 100 }, (_, i) => item(String(i), i)),
      3,
    );
    const copy = structuredClone(base);
    const { layout, markers } = readableFlow(
      base,
      flowMarkers(base.placements),
    );
    expect(markers).toHaveLength(1);
    expect(markers[0].items).toHaveLength(100);
    expect(layout.height).toBe(base.height);
    expect(base).toEqual(copy);
  });
  it("минута не уменьшается при последовательном увеличении масштаба", () => {
    const heights = [3, 5, 8, 12, 20, 32, 64].map(
      (scale) => build([item("one", 0)], scale).layout.placements[0].height,
    );
    expect(heights).toEqual([...heights].sort((a, b) => a - b));
    expect(heights[0]).toBe(44);
    expect(heights.at(-1)).toBe(64);
  });
});
