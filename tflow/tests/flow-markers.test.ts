import { describe, expect, it } from "vitest";
import { layoutFlow } from "../lib/flow-layout";
import { flowMarkers, FLOW_MARKER_HEIGHT } from "../lib/flow-markers";
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

describe("заметные маркеры коротких активностей", () => {
  it("оставляет минуту на точном времени, добавляя отдельную читаемую подпись", () => {
    const layout = layoutFlow([item("minute", 20), item("hour", 30, 60)], 3);
    const snapshot = structuredClone(layout.placements);
    const [marker] = flowMarkers(layout.placements);
    expect(marker.items.map((p) => p.activity.id)).toEqual(["minute"]);
    expect(marker.top + FLOW_MARKER_HEIGHT / 2).toBe(
      layout.placements[0].top + 1.5,
    );
    expect(layout.placements).toEqual(snapshot);
    expect(layout.placements[0].height).toBe(3);
    expect(layout.placements[1].height).toBe(180);
  });

  it("собирает сто соседних минут в одну плашку, сохраняя доступ ко всем пунктам", () => {
    const activities = Array.from({ length: 100 }, (_, i) =>
      item(`minute-${i}`, i),
    );
    const [marker] = flowMarkers(layoutFlow(activities, 3).placements);
    expect(marker.items.map((p) => p.activity.id)).toEqual(
      activities.map((a) => a.id),
    );
  });

  it("оставляет разнесённые во времени подписи отдельными и не объединяет параллельные дорожки", () => {
    const markers = flowMarkers(
      layoutFlow([item("a", 0), item("b", 0), item("later", 30)], 3).placements,
    );
    expect(markers).toHaveLength(3);
    expect(markers[0].right).toBeLessThanOrEqual(markers[1].left);
  });

  it("учитывает соседний короткий пункт, чтобы плашка минуты не закрыла его название", () => {
    const markers = flowMarkers(
      layoutFlow([item("minute", 0), item("short", 1, 10)], 3).placements,
    );
    expect(markers).toHaveLength(1);
    expect(markers[0].items).toHaveLength(2);
  });

  it("при увеличении масштаба возвращает обычную полосу с названием", () => {
    expect(flowMarkers(layoutFlow([item("minute", 0)], 64).placements)).toEqual(
      [],
    );
  });
});
