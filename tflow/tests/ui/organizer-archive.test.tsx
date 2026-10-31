import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TFlow } from "../../app/tflow";
import { event, profile } from "../fixtures";
import type { FlowEvent, UserIdentity } from "../../lib/types";

const host: UserIdentity = {
  userId: event.owner_id,
  displayName: "Организатор",
  email: "host@example.test",
  fullName: "Организатор",
  role: "organizer",
};
beforeEach(() => {
  history.replaceState({}, "", "/#organizer");
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});
afterEach(() => history.replaceState({}, "", "/"));

function mockEvents(getEvents: () => FlowEvent[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            events: getEvents(),
            tickets: [],
            schedule: [],
            waitlist: [],
            communities: [],
            notifications: [],
            unread_notification_count: 0,
            profile: { ...profile, id: host.userId, role: "organizer" },
          }),
          { status: 200 },
        ),
    ),
  );
}

const titles = () =>
  screen
    .queryAllByRole("article")
    .map(
      (article) =>
        within(article).getByRole("heading", { level: 2 }).textContent,
    );

describe("разделы моих событий", () => {
  it("открывает ближайшие события, а прошедшие показывает только в архиве", async () => {
    const now = event.starts_at;
    vi.spyOn(Date, "now").mockReturnValue(now);
    mockEvents(() => [
      {
        ...event,
        id: "old",
        title: "Давняя встреча",
        starts_at: now - 6000,
        ends_at: now - 5000,
      },
      {
        ...event,
        id: "later",
        title: "Поздняя встреча",
        starts_at: now + 3000,
      },
      {
        ...event,
        id: "recent",
        title: "Недавно завершилась",
        starts_at: now - 2000,
        ends_at: now,
      },
      {
        ...event,
        id: "draft",
        title: "Будущий черновик",
        status: "draft",
        starts_at: now + 1000,
      },
      { ...event, id: "ongoing", title: "Идёт сейчас", starts_at: now - 1000 },
      {
        ...event,
        id: "other",
        owner_id: "another-host",
        title: "Чужое событие",
      },
    ]);
    const user = userEvent.setup();
    render(<TFlow user={host} />);
    await screen.findByRole("button", { name: "Предстоящие · 3" });
    expect(titles()).toEqual([
      "Идёт сейчас",
      "Будущий черновик",
      "Поздняя встреча",
    ]);
    await user.click(screen.getByRole("button", { name: "Архив · 2" }));
    expect(titles()).toEqual(["Недавно завершилась", "Давняя встреча"]);
    expect(screen.getByRole("button", { name: "Архив · 2" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await user.click(screen.getByRole("button", { name: "Предстоящие · 3" }));
    expect(titles()).toEqual([
      "Идёт сейчас",
      "Будущий черновик",
      "Поздняя встреча",
    ]);
  });

  it("обновляет архив после окончания и возвращает перенесённое событие в предстоящие", async () => {
    let now = event.starts_at;
    let current = { ...event, ends_at: now + 1000 };
    vi.spyOn(Date, "now").mockImplementation(() => now);
    mockEvents(() => [current]);
    const user = userEvent.setup();
    render(<TFlow user={host} />);
    await screen.findByRole("button", { name: "Предстоящие · 1" });
    now += 1000;
    fireEvent.focus(window);
    await screen.findByText("Нет предстоящих событий");
    expect(titles()).toEqual([]);
    await user.click(screen.getByRole("button", { name: "Архив · 1" }));
    expect(titles()).toEqual([event.title]);
    current = { ...current, starts_at: now + 1000, ends_at: now + 2000 };
    fireEvent.focus(window);
    await screen.findByText("Архив пока пуст");
    await user.click(
      screen.getByRole("button", { name: "К предстоящим событиям" }),
    );
    await waitFor(() => expect(titles()).toEqual([event.title]));
  });
});
