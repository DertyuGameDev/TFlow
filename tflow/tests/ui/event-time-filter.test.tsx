import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TFlow } from "../../app/tflow";
import { event, profile } from "../fixtures";

afterEach(() => history.replaceState({}, "", "/"));

describe("фильтр активных событий", () => {
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
