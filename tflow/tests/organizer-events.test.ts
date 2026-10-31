import { describe, expect, it } from "vitest";
import { splitOrganizerEvents } from "../lib/organizer-events";
import { event } from "./fixtures";

describe("архив событий организатора", () => {
  it("считает прошедшим событие с момента окончания, включая черновики", () => {
    const now = event.starts_at;
    const ongoing = {
      ...event,
      id: "ongoing",
      starts_at: now - 1000,
      ends_at: now + 1,
    };
    const ended = { ...event, id: "ended", ends_at: now };
    const oldDraft = {
      ...event,
      id: "old-draft",
      status: "draft" as const,
      ends_at: now - 1,
    };
    const futureDraft = {
      ...event,
      id: "future-draft",
      status: "draft" as const,
      starts_at: now + 1000,
    };
    const sections = splitOrganizerEvents(
      [futureDraft, ended, oldDraft, ongoing],
      now,
    );
    expect(sections.upcoming.map((e) => e.id)).toEqual([
      "ongoing",
      "future-draft",
    ]);
    expect(sections.archive.map((e) => e.id)).toEqual(["ended", "old-draft"]);
  });

  it("сортирует будущие по началу, архив по окончанию в обратном порядке, сохраняя исходный список", () => {
    const now = event.starts_at;
    const events = [
      { ...event, id: "later", starts_at: now + 3000 },
      { ...event, id: "old", starts_at: now - 5000, ends_at: now - 4000 },
      { ...event, id: "sooner", starts_at: now + 1000 },
      { ...event, id: "recent", starts_at: now - 3000, ends_at: now - 1000 },
    ];
    const sections = splitOrganizerEvents(Object.freeze(events), now);
    expect(sections.upcoming.map((e) => e.id)).toEqual(["sooner", "later"]);
    expect(sections.archive.map((e) => e.id)).toEqual(["recent", "old"]);
    expect(events.map((e) => e.id)).toEqual([
      "later",
      "old",
      "sooner",
      "recent",
    ]);
  });
});
