import test from "node:test";
import assert from "node:assert/strict";
import { calendarDate, calendarEntries, dayStart, entriesForDay, isCalendarDate, monthDays, positionDayEntries, shiftDays, shiftMonths } from "./calendar.ts";

const event = (id, starts_at = dayStart("2026-10-30") + 10 * 3_600_000, ends_at = starts_at + 3_600_000) => ({
  id, title: id, owner_id: "host", starts_at, ends_at, city: "Москва", venue: "Зал", description: "Описание", status: "published",
});
const entry = (id, start, end) => ({ ...event(id, dayStart("2026-10-30") + start * 60_000, dayStart("2026-10-30") + end * 60_000), eventId: id, source: "ticket", location: "Зал", draft: false });
const data = (changes = {}) => ({ events: [], tickets: [], schedule: [], communities: [], notifications: [], profile: null, ...changes });

test("Moscow date changes at 21:00 UTC, not at the browser's midnight", () => {
  assert.equal(calendarDate(Date.parse("2026-10-30T20:59:59Z")), "2026-10-30");
  assert.equal(calendarDate(Date.parse("2026-10-30T21:00:00Z")), "2026-10-31");
  assert.equal(dayStart("2026-10-31"), Date.parse("2026-10-30T21:00:00Z"));
});

test("date input rejects impossible, malformed and out-of-range dates", () => {
  for (const date of [undefined, "", "broken", "2026-02-29", "2026-04-31", "2026-13-01", "2026-2-01", "1899-12-31"]) {
    assert.equal(isCalendarDate(date), false, String(date));
  }
  assert.equal(isCalendarDate("2028-02-29"), true);
});

test("month navigation clamps the day for leap years and crosses the year", () => {
  assert.equal(shiftMonths("2026-01-31", 1), "2026-02-28");
  assert.equal(shiftMonths("2028-01-31", 1), "2028-02-29");
  assert.equal(shiftMonths("2026-12-31", 1), "2027-01-31");
  assert.equal(shiftMonths("2026-03-31", -1), "2026-02-28");
  assert.equal(shiftDays("2026-12-31", 1), "2027-01-01");
});

test("month grid starts on Monday and contains exactly the necessary whole weeks", () => {
  const october = monthDays("2026-10-30");
  assert.equal(october.length, 35);
  assert.equal(october[0], "2026-09-28");
  assert.equal(october.at(-1), "2026-11-01");
  assert.equal(monthDays("2026-08-15").length, 42);
  assert.equal(monthDays("2027-02-10").length, 28);
  assert.ok(monthDays("2028-02-10").includes("2028-02-29"));
});

test("navigation respects supported date limits without throwing", () => {
  assert.equal(shiftMonths("9999-12-31", 1), "9999-12-31");
  assert.equal(shiftDays("9999-12-31", 1), "9999-12-31");
  assert.equal(shiftMonths("1900-01-01", -1), "1900-01-01");
  assert.equal(monthDays("9999-12-01").length % 7, 0);
});

test("personal calendar includes tickets, programme and own drafts, excluding unrelated catalog events", () => {
  const own = { ...event("own"), owner_id: "me", status: "draft" };
  const result = calendarEntries(data({
    events: [own, event("public")], tickets: [event("ticket")],
    schedule: [{ ...event("activity"), event_id: "ticket", event_title: "Конференция", room_name: "Аудитория" }],
  }), "me");
  assert.deepEqual(new Set(result.map(item => item.source)), new Set(["owned", "ticket", "activity"]));
  assert.ok(!result.some(item => item.eventId === "public"));
  assert.equal(result.find(item => item.source === "owned").draft, true);
  assert.equal(result.find(item => item.source === "activity").eventTitle, "Конференция");
});

test("an owned event with an own ticket appears only once", () => {
  const own = { ...event("own"), owner_id: "me" };
  assert.equal(calendarEntries(data({ events: [own], tickets: [own] }), "me").length, 1);
});

test("calendar activity keeps its registration target and current seat counts", () => {
  const result = calendarEntries(data({schedule:[{...event("session"),event_id:"conference",room_name:"Зал",capacity:5,taken:3}]}), "me")[0];
  assert.equal(result.activityId, "session");
  assert.equal(result.eventId, "conference");
  assert.equal(result.capacity-result.taken, 2);
});

test("invalid event durations never produce broken calendar blocks", () => {
  assert.equal(calendarEntries(data({ tickets: [event("zero", 0, 0), event("negative", 2, 1), event("nan", NaN, 3)] }), "me").length, 0);
});

test("midnight endings are exclusive: no phantom event on the following day", () => {
  const item = entry("late", 23 * 60, 24 * 60);
  assert.equal(entriesForDay([item], "2026-10-30").length, 1);
  assert.equal(entriesForDay([item], "2026-10-31").length, 0);
});

test("overnight events are clipped to each day, preserving the original dates", () => {
  const item = entry("overnight", 23 * 60, 26 * 60);
  const first = entriesForDay([item], "2026-10-30")[0];
  const second = entriesForDay([item], "2026-10-31")[0];
  assert.deepEqual([first.startMinute, first.endMinute, first.continuesAfter], [1380, 1440, true]);
  assert.deepEqual([second.startMinute, second.endMinute, second.continuesBefore], [0, 120, true]);
  assert.equal(second.entry.starts_at, item.starts_at);
});

test("multi-day event covers the full intermediate day", () => {
  const item = entry("conference", 600, 3 * 1440 + 600);
  const middle = entriesForDay([item], "2026-11-01")[0];
  assert.deepEqual([middle.startMinute, middle.endMinute], [0, 1440]);
});

test("overlapping events use separate columns, adjacent events reuse full width", () => {
  const segments = entriesForDay([entry("a", 600, 660), entry("b", 630, 690), entry("c", 690, 750)], "2026-10-30");
  const [a, b, c] = positionDayEntries(segments);
  assert.equal(a.columns, 2);
  assert.equal(b.columns, 2);
  assert.notEqual(a.column, b.column);
  assert.equal(c.columns, 1);
  assert.equal(c.column, 0);
});

test("connected overlaps reuse columns and keep all original times", () => {
  const items = [entry("a", 600, 780), entry("b", 600, 660), entry("c", 660, 720), entry("d", 690, 750)];
  const positioned = positionDayEntries(entriesForDay(items, "2026-10-30"));
  assert.ok(positioned.every(item => item.columns === 3));
  for (let i = 0; i < positioned.length; i++) for (let j = i + 1; j < positioned.length; j++) {
    const a = positioned[i], b = positioned[j];
    if (a.startMinute < b.displayEnd && a.displayEnd > b.startMinute) assert.notEqual(a.column, b.column);
  }
  assert.equal(positioned.find(item => item.entry.id === "c").startMinute, 660);
});

test("short nearby events reserve readable labels in separate columns", () => {
  const result = positionDayEntries(entriesForDay([entry("brief", 600, 605), entry("next", 615, 620)], "2026-10-30"));
  assert.equal(result[0].displayEnd, 630);
  assert.notEqual(result[0].column, result[1].column);
});
