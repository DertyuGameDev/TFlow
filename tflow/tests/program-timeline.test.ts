import { describe, expect, it } from "vitest";
import {
  buildProgramTracks,
  itemsInRange,
  programColorMap,
  programDayBounds,
  programDayRange,
  programTimeTicks,
  projectProgramTracks,
  segmentBackground,
  shiftProgramDay,
} from "../lib/program-timeline";
import type { Activity } from "../lib/types";

const start = Date.parse("2026-11-12T10:00:00+03:00");
const minute = 60000;
function item(
  id: string,
  offset: number,
  duration: number,
  room = "main",
): Activity {
  return {
    id,
    event_id: "event",
    title: `Пункт ${id}`,
    description: "",
    speaker: "",
    room_id: room,
    room_name: room,
    starts_at: start + offset * minute,
    ends_at: start + (offset + duration) * minute,
    capacity: 30,
    taken: 0,
    registered: 0,
    waiting_count: 0,
    waitlisted: 0,
    waitlist_position: 0,
    updated_at: 0,
  };
}

describe("раскладка временной шкалы программы", () => {
  it("чередует пункты над общей осью и под ней с точными проекциями времени", () => {
    const tracks = buildProgramTracks(
      [item("a", 0, 20), item("b", 20, 40)],
      start,
      start + 120 * minute,
      600,
    );
    const layout = projectProgramTracks(
      tracks,
      start,
      start + 120 * minute,
      600,
    );
    expect(layout.nodes.map((node) => node.side)).toEqual(["above", "below"]);
    expect(layout.nodes.map((node) => [node.left, node.right])).toEqual([
      [0, 100],
      [100, 300],
    ]);
    expect(layout.aboveRows).toBe(1);
    expect(layout.belowRows).toBe(1);
  });

  it("ограничивает плотные проекции четырьмя полосами и сохраняет каждую из тысячи записей", () => {
    const items = Array.from({ length: 1000 }, (_, index) =>
      item(String(index), 0, 30, `Зал ${index}`),
    );
    const tracks = buildProgramTracks(items, start, start + 60 * minute, 300);
    const before = JSON.stringify(tracks);
    const layout = projectProgramTracks(
      tracks,
      start,
      start + 60 * minute,
      300,
    );
    expect(layout.nodes.length).toBeLessThanOrEqual(4);
    expect(layout.aboveRows).toBeLessThanOrEqual(2);
    expect(layout.belowRows).toBeLessThanOrEqual(2);
    expect(
      new Set(
        layout.nodes.flatMap((node) =>
          node.segment.items.map((entry) => entry.id),
        ),
      ).size,
    ).toBe(1000);
    expect(layout.nodes.flatMap((node) => node.segment.items)).toHaveLength(
      1000,
    );
    expect(JSON.stringify(tracks)).toBe(before);
  });

  it("не сталкивает подписи в одной полосе и удерживает их в пределах шкалы", () => {
    const items = Array.from({ length: 120 }, (_, index) =>
      item(String(index), index, 1),
    );
    const layout = projectProgramTracks(
      buildProgramTracks(items, start, start + 120 * minute, 320),
      start,
      start + 120 * minute,
      320,
    );
    for (const node of layout.nodes) {
      expect(node.labelLeft).toBeGreaterThanOrEqual(0);
      expect(node.labelLeft + node.labelWidth).toBeLessThanOrEqual(320);
      const peers = layout.nodes.filter(
        (other) =>
          other !== node && other.side === node.side && other.row === node.row,
      );
      const left = Math.min(node.left, node.labelLeft),
        right = Math.max(node.right, node.labelLeft + node.labelWidth);
      for (const peer of peers) {
        const peerLeft = Math.min(peer.left, peer.labelLeft),
          peerRight = Math.max(peer.right, peer.labelLeft + peer.labelWidth);
        expect(right + 9.99 <= peerLeft || peerRight + 9.99 <= left).toBe(true);
      }
    }
  });

  it("подписывает основную ось удобными значениями времени вместо дробей интервала", () => {
    const from = Date.parse("2026-11-12T11:00:00+03:00"),
      to = Date.parse("2026-11-12T12:59:00+03:00");
    expect(
      programTimeTicks(from, to).map((value) =>
        new Date(value + 3 * 3600000).toISOString().slice(11, 16),
      ),
    ).toEqual(["11:00", "11:30", "12:00", "12:30", "12:59"]);
    const midnight = Date.parse("2026-11-12T00:00:00+03:00");
    expect(
      programTimeTicks(midnight, midnight + 86400000).map((value) =>
        new Date(value + 3 * 3600000).toISOString().slice(11, 16),
      ),
    ).toEqual(["00:00", "06:00", "12:00", "18:00", "00:00"]);
  });
  it("разносит подписи времени с учётом ширины, сохраняя точные границы мероприятия", () => {
    const from = Date.parse("2026-11-12T12:47:00+03:00");
    const to = Date.parse("2026-11-12T14:46:00+03:00");
    for (const width of [220, 280, 319, 480, 720, 1440]) {
      const ticks = programTimeTicks(from, to, width);
      expect(ticks[0]).toBe(from);
      expect(ticks.at(-1)).toBe(to);
      const boxes = ticks.map((tick, index) => {
        const x = ((tick - from) / (to - from)) * width;
        const left = index === 0 ? 0 : index === ticks.length - 1 ? width - 48 : x - 24;
        return { left, right: left + 48 };
      });
      for (let index = 1; index < boxes.length; index++) {
        expect(boxes[index].left - boxes[index - 1].right).toBeGreaterThanOrEqual(12);
      }
    }
    expect(programTimeTicks(from, to, 280)).not.toContain(Date.parse("2026-11-12T14:30:00+03:00"));
  });
  it("сохраняет длительность и свободные промежутки, сортирует входные пункты", () => {
    const tracks = buildProgramTracks(
      [item("b", 40, 40), item("a", 0, 20)],
      start,
      start + 120 * minute,
      600,
    );
    expect(
      tracks[0].segments.map((s) => [s.start - start, s.end - start]),
    ).toEqual([
      [0, 20 * minute],
      [40 * minute, 80 * minute],
    ]);
    expect(tracks[0].segments.flatMap((s) => s.items.map((a) => a.id))).toEqual(
      ["a", "b"],
    );
  });

  it("вмещает тысячу коротких пунктов без потерь и раскрывает их при увеличении", () => {
    const items = Array.from({ length: 1000 }, (_, index) =>
      item(String(index), index, 1),
    );
    const overview = buildProgramTracks(
      items,
      start,
      start + 1000 * minute,
      280,
    )[0];
    expect(overview.segments.length).toBeLessThanOrEqual(8);
    expect(overview.segments.flatMap((s) => s.items)).toHaveLength(1000);
    expect(
      new Set(overview.segments.flatMap((s) => s.items.map((a) => a.id))).size,
    ).toBe(1000);
    const zoomed = buildProgramTracks(
      items,
      start,
      start + 1000 * minute,
      64000,
    )[0];
    expect(zoomed.segments).toHaveLength(1000);
    for (const segment of overview.segments) {
      expect(segment.start).toBeGreaterThanOrEqual(start);
      expect(segment.end).toBeLessThanOrEqual(start + 1000 * minute);
    }
  });

  it("разносит параллельные пункты по аудиториям и не объединяет их", () => {
    const tracks = buildProgramTracks(
      [item("a", 0, 30, "Зал 1"), item("b", 0, 30, "Зал 2")],
      start,
      start + 60 * minute,
      600,
    );
    expect(tracks).toHaveLength(2);
    expect(tracks.map((t) => t.name)).toEqual(["Зал 1", "Зал 2"]);
  });

  it("не объединяет короткие пункты через большой свободный промежуток", () => {
    const track = buildProgramTracks(
      [item("a", 0, 1), item("b", 80, 1)],
      start,
      start + 120 * minute,
      300,
    )[0];
    expect(track.segments).toHaveLength(2);
  });

  it("сохраняет даже короткие перерывы между плотными пунктами", () => {
    const track = buildProgramTracks(
      [item("a", 0, 1), item("b", 2, 1)],
      start,
      start + 120 * minute,
      300,
    )[0];
    expect(track.segments).toHaveLength(2);
    expect(track.segments[0].end).toBeLessThan(track.segments[1].start);
  });

  it("обрезает переходящие полночь пункты по границам дня и учитывает исключающий конец", () => {
    const from = Date.parse("2026-11-12T23:30:00+03:00"),
      to = Date.parse("2026-11-14T00:00:00+03:00");
    expect(programDayBounds(from, to)).toEqual({
      first: "2026-11-12",
      last: "2026-11-13",
    });
    const first = programDayRange("2026-11-12", from, to),
      second = programDayRange("2026-11-13", from, to);
    expect(first.end).toBe(second.start);
    const overnight = {
      ...item("night", 0, 60),
      starts_at: from,
      ends_at: from + 60 * minute,
    };
    expect(itemsInRange([overnight], first.start, first.end)).toHaveLength(1);
    expect(itemsInRange([overnight], second.start, second.end)).toHaveLength(1);
    const segment = buildProgramTracks(
      [overnight],
      second.start,
      second.end,
      500,
    )[0].segments[0];
    expect(segment.start).toBe(second.start);
    expect(segment.end).toBe(overnight.ends_at);
    expect(
      itemsInRange(
        [{ ...overnight, ends_at: second.start }],
        second.start,
        second.end,
      ),
    ).toHaveLength(0);
    expect(shiftProgramDay("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("даёт соседним пунктам разные цвета, сохраняет их независимо от порядка входных данных", () => {
    const items = [item("a", 0, 10), item("b", 10, 10)];
    const colors = programColorMap(items);
    expect(colors.get("a")).not.toBe(colors.get("b"));
    expect(programColorMap([...items].reverse())).toEqual(colors);
    const group = buildProgramTracks(items, start, start + 60 * minute, 100)[0]
      .segments[0];
    expect(segmentBackground(group, colors)).toContain("linear-gradient");
    expect(buildProgramTracks(items, start, start, 300)).toEqual([]);
  });
});
