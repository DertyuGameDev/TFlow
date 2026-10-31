import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ProfileUpcomingEvents } from "../../app/ui/profile-upcoming-events";
import type { FlowEvent } from "../../lib/types";
import { event } from "../fixtures";

const now = Date.parse("2026-11-12T10:00:00+03:00");
const hour = 3600000;
function meeting(
  id: string,
  offset: number,
  extra: Partial<FlowEvent> = {},
): FlowEvent {
  return {
    ...event,
    id,
    title: id,
    starts_at: now + offset * hour,
    ends_at: now + (offset + 2) * hour,
    ...extra,
  };
}

describe("ближайшие мероприятия в профиле организатора", () => {
  it("показывает только свои незавершённые встречи по времени, отмечая эфир и черновик", () => {
    render(
      <ProfileUpcomingEvents
        organizerId={event.owner_id}
        now={now}
        onCreate={vi.fn()}
        events={[
          meeting("Позже", 4),
          meeting("Чужое событие", 1, { owner_id: "someone-else" }),
          meeting("Закончилось", -2),
          meeting("Подготовить встречу", 2, { status: "draft" }),
          meeting("Встреча началась", -1),
        ]}
      />,
    );
    const links = screen.getAllByRole("link", {
      name: /Управлять мероприятием/,
    });
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "#manage/Встреча началась",
      "#manage/Подготовить встречу",
      "#manage/Позже",
    ]);
    expect(screen.getByText("Идёт сейчас")).toBeVisible();
    expect(screen.getByText("Черновик")).toBeVisible();
    expect(screen.queryByText("Чужое событие")).not.toBeInTheDocument();
    expect(screen.queryByText("Закончилось")).not.toBeInTheDocument();
  });

  it("оставляет четыре ближайших события и ссылку на полный список", () => {
    render(
      <ProfileUpcomingEvents
        organizerId={event.owner_id}
        now={now}
        onCreate={vi.fn()}
        events={[6, 5, 4, 3, 2, 1].map((number) =>
          meeting(`Встреча ${number}`, number),
        )}
      />,
    );
    expect(
      screen
        .getAllByRole("link", { name: /Управлять мероприятием/ })
        .map((link) => link.textContent),
    ).toEqual([
      expect.stringContaining("Встреча 1"),
      expect.stringContaining("Встреча 2"),
      expect.stringContaining("Встреча 3"),
      expect.stringContaining("Встреча 4"),
    ]);
    expect(screen.queryByText("Встреча 5")).not.toBeInTheDocument();
    expect(screen.getByText("Ближайшие 4 из 6 · время по МСК")).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Все мои мероприятия" }),
    ).toHaveAttribute("href", "#organizer");
  });

  it("показывает дату и время по МСК, в том числе после полуночи", () => {
    render(
      <ProfileUpcomingEvents
        organizerId={event.owner_id}
        now={now}
        onCreate={vi.fn()}
        events={[
          meeting("Ночная встреча", 0, {
            starts_at: Date.parse("2026-11-12T21:30:00Z"),
            ends_at: Date.parse("2026-11-12T22:30:00Z"),
          }),
        ]}
      />,
    );
    expect(screen.getByText(/13 ноября 2026.*00:30/)).toBeVisible();
  });

  it("предлагает создать событие, если предстоящих встреч нет", async () => {
    const user = userEvent.setup(),
      onCreate = vi.fn();
    render(
      <ProfileUpcomingEvents
        organizerId={event.owner_id}
        now={now}
        onCreate={onCreate}
        events={[
          meeting("Архив", -5),
          meeting("Чужая встреча", 1, { owner_id: "another" }),
        ]}
      />,
    );
    expect(screen.getByText(/Пока нет предстоящих мероприятий/)).toBeVisible();
    expect(
      screen.queryByRole("link", { name: /Управлять мероприятием/ }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Создать событие" }));
    expect(onCreate).toHaveBeenCalledOnce();
  });
});
