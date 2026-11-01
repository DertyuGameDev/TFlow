import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Clubs } from "../../app/ui/clubs";
import type { Bootstrap, Community, FlowEvent } from "../../lib/types";
import { event } from "../fixtures";

const club: Community = {
  id: "club",
  name: "Клуб встреч",
  description: "Общаемся и учимся",
  topic: "Разработка",
  color: "yellow",
  member_count: 5,
  joined: 0,
  subscribed: false,
  owner_id: "host",
  event_count: 4,
  avatar_url: null,
};
function props(events: FlowEvent[]) {
  return {
    data: {
      events,
      tickets: [],
      schedule: [],
      waitlist: [],
      communities: [club],
      notifications: [],
      unread_notification_count: 0,
      profile: null,
    } satisfies Bootstrap,
    user: null,
    clubId: club.id,
    send: vi.fn(),
    onChange: vi.fn(),
    onOpenClub: vi.fn(),
    onOpenEvent: vi.fn(),
    onCreateEvent: vi.fn(),
  };
}
afterEach(() => vi.restoreAllMocks());

describe("периоды событий клуба", () => {
  it("разделяет предстоящие и прошедшие, показывает их количество и открывает выбранную встречу", async () => {
    const user = userEvent.setup(),
      now = event.starts_at;
    vi.spyOn(Date, "now").mockReturnValue(now);
    const make = (id: string, start: number, end: number) => ({
      ...event,
      id,
      title: id,
      community_id: club.id,
      starts_at: now + start,
      ends_at: now + end,
    });
    const older = make("Давняя встреча", -4000, -3000);
    const endedNow = make("Только что завершилась", -2000, 0);
    const ongoing = make("Уже идёт", -1000, 1000);
    const future = make("Следующая встреча", 2000, 3000);
    const initial = props([
      future,
      older,
      ongoing,
      endedNow,
      { ...older, id: "other", title: "Другой клуб", community_id: "other" },
    ]);
    render(<Clubs {...initial} />);
    const periods = screen.getByRole("group", { name: "Период событий клуба" });
    const upcoming = within(periods).getByRole("button", {
      name: "Предстоящие 2",
    });
    const past = within(periods).getByRole("button", { name: "Прошедшие 2" });
    expect(upcoming).toHaveAttribute("aria-pressed", "true");
    expect(
      screen
        .getAllByRole("button")
        .filter((el) => /Уже идёт|Следующая встреча/.test(el.textContent ?? ""))
        .map((el) => el.textContent),
    ).toEqual([
      expect.stringContaining("Уже идёт"),
      expect.stringContaining("Следующая встреча"),
    ]);
    expect(screen.queryByText(older.title)).not.toBeInTheDocument();
    await user.click(past);
    expect(past).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText(ongoing.title)).not.toBeInTheDocument();
    expect(screen.queryByText("Другой клуб")).not.toBeInTheDocument();
    const ended = screen.getByRole("button", {
      name: new RegExp(endedNow.title),
    });
    expect(
      ended.compareDocumentPosition(screen.getByText(older.title)) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    await user.click(ended);
    expect(initial.onOpenEvent).toHaveBeenCalledExactlyOnceWith(endedNow);
    await user.click(upcoming);
    expect(screen.getByText(ongoing.title)).toBeVisible();
  });

  it("оставляет переключатель доступным в пустом клубе и объясняет пустой архив", async () => {
    const user = userEvent.setup();
    render(<Clubs {...props([])} />);
    expect(screen.getByText("Новые встречи ещё впереди")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Прошедшие 0" }));
    expect(screen.getByText("Прошедших событий пока нет")).toBeVisible();
    expect(screen.getByRole("button", { name: "Предстоящие 0" })).toBeEnabled();
  });
});
