import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { OrganizerProgramList } from "../../app/ui/organizer-program-list";
import type { Activity } from "../../lib/types";
import { event } from "../fixtures";

const item = (index: number): Activity => ({
  id: String(index),
  event_id: event.id,
  title: `Пункт ${index}`,
  description: "",
  speaker: "Анна",
  room_id: "main",
  room_name: "Главный зал",
  starts_at: event.starts_at + index * 60000,
  ends_at: event.starts_at + (index + 1) * 60000,
  capacity: 20,
  taken: 2,
  registered: 0,
  waiting_count: 0,
  waitlisted: 0,
  waitlist_position: 0,
  updated_at: 1,
});

describe("список программы организатора", () => {
  it("сразу раскрывает строки по времени и открывает редактирование выбранной", async () => {
    const first = item(0),
      second = item(1),
      onEdit = vi.fn(),
      user = userEvent.setup();
    render(
      <OrganizerProgramList activities={[second, first]} onEdit={onEdit} />,
    );
    const rows = screen.getAllByRole("listitem");
    expect(within(rows[0]).getByRole("heading")).toHaveTextContent("Пункт 0");
    expect(within(rows[1]).getByRole("heading")).toHaveTextContent("Пункт 1");
    expect(rows[0]).toHaveTextContent("10:00–10:01");
    expect(rows[0]).toHaveTextContent("Главный зал · Анна");
    await user.click(within(rows[1]).getByRole("button"));
    expect(onEdit).toHaveBeenCalledExactlyOnceWith(second);
  });
  it("ограничивает длинный список страницами и находит последний из тысячи пунктов", async () => {
    const user = userEvent.setup();
    render(
      <OrganizerProgramList
        activities={Array.from({ length: 1000 }, (_, index) => item(index))}
        onEdit={vi.fn()}
      />,
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(12);
    await user.click(
      screen.getByRole("button", { name: "Следующая страница программы" }),
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(12);
    expect(screen.getByText("13–24 из 1000")).toBeVisible();
    await user.type(
      screen.getByRole("searchbox", { name: "Найти пункт программы" }),
      "Пункт 999",
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Пункт 999" })).toBeVisible();
  });
});
