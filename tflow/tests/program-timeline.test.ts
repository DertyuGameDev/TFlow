import { describe, expect, it } from "vitest";
import {
  buildProgramTracks,
  itemsInRange,
  programColorMap,
  programDayBounds,
  programDayRange,
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
