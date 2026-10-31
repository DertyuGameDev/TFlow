import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TFlow } from "../../app/tflow";
import { event, profile } from "../fixtures";

afterEach(() => history.replaceState({}, "", "/"));

describe("фильтр активных событий", () => {
  it("во «Всех» ставит завершённые в конец, сохраняя порядок внутри групп и доступ к карточке", async () => {
    const now = event.starts_at;
    vi.spyOn(Date, "now").mockReturnValue(now);
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    history.replaceState({}, "", "/#events");
    const events = [
      { ...event, id: "past", title: "Прошедшая встреча", starts_at: now - 7200000, ends_at: now - 1, enrolled: 1 },
      { ...event, id: "current", title: "Текущая встреча" },
      { ...event, id: "boundary", title: "Только что завершилась", starts_at: now - 3600000, ends_at: now },
      { ...event, id: "future", title: "Будущая встреча", starts_at: now + 7200000, ends_at: now + 10800000 },
    ];
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      events, tickets: [], schedule: [], waitlist: [], communities: [], notifications: [], unread_notification_count: 0, profile,
    }), { status: 200 })));
    const user = userEvent.setup();
    const { container } = render(<TFlow user={null} />);
    await screen.findByText("Текущая встреча");
    const grid = within(container.querySelector<HTMLElement>(".discovery-grid")!);
    expect(grid.getAllByRole("heading", { level: 2 }).map(heading => heading.textContent)).toEqual([
      "Текущая встреча", "Будущая встреча", "Прошедшая встреча", "Только что завершилась",
    ]);
    const cards = grid.getAllByRole("article");
    expect(cards[0]).not.toHaveClass("is-past");
    expect(cards[1]).not.toHaveClass("is-past");
    expect(cards[2]).toHaveClass("is-past");
    expect(cards[3]).toHaveClass("is-past");
    expect(within(cards[2]).getByText("Завершено")).toBeVisible();
    expect(within(cards[2]).getByText("Вы были записаны")).toBeVisible();
    expect(within(cards[2]).getByRole("button", { name: "Открыть Прошедшая встреча" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Активные" }));
    expect(screen.queryByText("Завершено")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Все" }));
    expect(grid.getAllByRole("heading", { level: 2 }).map(heading => heading.textContent)).toEqual([
      "Текущая встреча", "Будущая встреча", "Прошедшая встреча", "Только что завершилась",
    ]);
    expect(events[0].id).toBe("past");
  });

  it("фильтрует каталог и сбрасывает выбранное состояние", async () => {
    const now = event.starts_at;
    vi.spyOn(Date, "now").mockReturnValue(now);
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    history.replaceState({}, "", "/#events");
    const events = [
      { ...event, id: "now", title: "Идёт сейчас" },
      { ...event, id: "past", title: "Уже прошло", starts_at: now - 7200000, ends_at: now - 1 },
      { ...event, id: "draft", title: "Черновик", status: "draft" },
    ];
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      events, tickets: [], schedule: [], waitlist: [], communities: [], notifications: [], unread_notification_count: 0, profile,
    }), { status: 200 })));
    const user = userEvent.setup();
    render(<TFlow user={null} />);
    expect(await screen.findByText("Идёт сейчас")).toBeVisible();
    expect(screen.getByText("Уже прошло")).toBeVisible();
    expect(screen.queryByText("Черновик")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Активные" }));
    expect(screen.getByText("Идёт сейчас")).toBeVisible();
    expect(screen.queryByText("Уже прошло")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Активные" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Завершённые" }));
    expect(screen.queryByText("Идёт сейчас")).not.toBeInTheDocument();
    expect(screen.getByText("Уже прошло")).toBeVisible();
    await user.click(screen.getByRole("button", { name: /Сбросить/ }));
    await waitFor(() => expect(screen.getByText("Идёт сейчас")).toBeVisible());
    expect(screen.getByText("Уже прошло")).toBeVisible();
  });
});
