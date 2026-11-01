import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Calendar } from "../../app/ui/calendar";
import type { Bootstrap, FlowEvent } from "../../lib/types";
import { event } from "../fixtures";

function props(events: FlowEvent[] = [event]) {
  return {
    data: {
      events,
      tickets: events,
      schedule: [],
      waitlist: [],
      communities: [],
      notifications: [],
      unread_notification_count: 0,
      profile: null,
    } satisfies Bootstrap,
    userId: "viewer",
    initialDate: "2026-11-12",
    canCreate: false,
    onOpenEvent: vi.fn(),
    onOpenWebinar: vi.fn(),
    onCreate: vi.fn(),
    onBrowse: vi.fn(),
    onCancelEvent: vi.fn(),
    onCancelActivity: vi.fn(),
  };
}

describe("навигация календаря", () => {
  it("возвращает из дня в тот же месяц, сохраняя дату и фильтры и возвращая фокус на дату", async () => {
    const user = userEvent.setup();
    render(<Calendar {...props()} />);
    const filters = screen.getByRole("complementary", {
      name: "Настройки календаря",
    });
    await user.click(
      within(filters).getByRole("checkbox", { name: "Активности" }),
    );
    expect(
      screen.queryByRole("button", { name: "К месяцу" }),
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", {
        name: /Открыть четверг, 12 ноября 2026 г./,
      }),
    );
    await user.click(screen.getByRole("button", { name: "Следующий день" }));
    await user.click(screen.getByRole("button", { name: "К месяцу" }));
    expect(screen.getByRole("table")).toBeVisible();
    expect(
      screen.getByRole("button", {
        name: /Открыть пятница, 13 ноября 2026 г./,
      }),
    ).toHaveFocus();
    expect(window.location.hash).toBe("#calendar/2026-11-13/month");
    expect(
      within(filters).getByRole("checkbox", { name: "Активности" }),
    ).not.toBeChecked();
  });

  it("из кнопки остальных планов открывает полный день и возвращает обратно", async () => {
    const user = userEvent.setup();
    const initial = props(
      Array.from({ length: 5 }, (_, i) => ({
        ...event,
        id: `event-${i}`,
        title: `Встреча ${i + 1}`,
      })),
    );
    render(<Calendar {...initial} />);
    await user.click(
      screen.getByRole("button", { name: "Все планы на 12 ноября: 5 планов" }),
    );
    expect(screen.getByRole("status")).toHaveTextContent("5 планов");
    expect(
      screen.getByRole("button", { name: /^Встреча 5,/ }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "К месяцу" }));
    expect(screen.getByRole("table")).toBeVisible();
    expect(initial.onCreate).not.toHaveBeenCalled();
    expect(initial.onBrowse).not.toHaveBeenCalled();
  });

  it("открывает подробности встречи из подписи в месяце", async () => {
    const user = userEvent.setup();
    render(<Calendar {...props()} />);
    await user.click(screen.getByRole("button", { name: /^Открытая лекция,/ }));
    expect(screen.getByRole("dialog", { name: event.title })).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: "Закрыть" }),
    );
    expect(screen.getByRole("table")).toBeVisible();
  });
});
