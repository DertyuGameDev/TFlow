import { describe, expect, it } from "vitest";
import {
  createProgramRange,
  moveProgramRange,
  PROGRAM_MINUTE as minute,
  programRangeConflict,
  resizeProgramRange,
  timelineTimeAt,
} from "../lib/program-editing";
import type { Activity } from "../lib/types";

const start = Date.parse("2026-11-12T10:00:00+03:00"),
  end = start + 120 * minute;
const range = { starts_at: start + 30 * minute, ends_at: start + 60 * minute };
describe("редактирование времени на шкале", () => {
  it("перемещает весь блок, сохраняя длительность у обеих границ мероприятия", () => {
    expect(moveProgramRange(range, 15 * minute, start, end)).toEqual({starts_at: start + 45 * minute, ends_at: start + 75 * minute});
    expect(moveProgramRange(range, -100 * minute, start, end)).toEqual({starts_at: start, ends_at: start + 30 * minute});
    expect(moveProgramRange(range, 100 * minute, start, end)).toEqual({starts_at: end - 30 * minute, ends_at: end});
  });
  it("учитывает прокрутку и масштаб, округляет шаг и ограничивает границы дня", () => {
    expect(timelineTimeAt(225, -100, 600, start, end, 5 * minute)).toBe(
      start + 65 * minute,
    );
    expect(timelineTimeAt(225, -100, 1200, start, end, minute)).toBe(
      start + 33 * minute,
    );
    expect(timelineTimeAt(-1000, 0, 600, start, end, minute)).toBe(start);
    expect(timelineTimeAt(1000, 0, 600, start, end, minute)).toBe(end);
  });
  it("создаёт отрезок в обе стороны и не выходит за конец мероприятия при нажатии", () => {
    expect(
      createProgramRange(start + 60 * minute, start + 30 * minute, start, end),
    ).toEqual(range);
    expect(
      createProgramRange(start + 30 * minute, start + 60 * minute, start, end),
    ).toEqual(range);
    expect(createProgramRange(end, end, start, end, true)).toEqual({
      starts_at: end - minute,
      ends_at: end,
    });
    expect(createProgramRange(start, start, start, end, true).ends_at).toBe(
      start + 30 * minute,
    );
  });
  it("не позволяет перевернуть отрезок, выйти за мероприятие и сохраняет другую границу", () => {
    expect(resizeProgramRange(range, "start", end, start, end)).toEqual({
      starts_at: range.ends_at - minute,
      ends_at: range.ends_at,
    });
    expect(resizeProgramRange(range, "end", start, start, end)).toEqual({
      starts_at: range.starts_at,
      ends_at: range.starts_at + minute,
    });
    expect(
      resizeProgramRange(range, "start", start - minute, start, end).starts_at,
    ).toBe(start);
    expect(
      resizeProgramRange(range, "end", end + minute, start, end).ends_at,
    ).toBe(end);
  });
  it("допускает параллельные аудитории и соприкосновение границ, но обнаруживает пересечение в одном зале", () => {
    const activity = { id: "a", room_id: "main", ...range } as Activity;
    const next = {
      ...activity,
      id: "b",
      starts_at: range.ends_at,
      ends_at: end,
    };
    expect(
      programRangeConflict(activity, range, [activity, next]),
    ).toBeUndefined();
    const extended = { ...range, ends_at: range.ends_at + minute };
    expect(programRangeConflict(activity, extended, [next])).toBe(next);
    expect(
      programRangeConflict(activity, extended, [
        { ...next, room_id: "online" },
      ]),
    ).toBeUndefined();
  });
});
