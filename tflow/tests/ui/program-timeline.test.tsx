import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProgramTimeline } from "../../app/ui/program-timeline";
import type { Activity } from "../../lib/types";
import { event } from "../fixtures";

function item(index: number, duration = 30): Activity {
  return {
    id: `item-${index}`,
    event_id: event.id,
    title: `Лекция ${index}`,
    description: "Описание выступления",
    speaker: "Анна Смирнова",
    room_id: "main",
    room_name: "Главный зал",
    starts_at: event.starts_at + index * duration * 60000,
    ends_at: event.starts_at + (index + 1) * duration * 60000,
    capacity: 20,
    taken: 3,
    registered: 0,
    waitlisted: 0,
    waiting_count: 0,
    waitlist_position: 0,
    updated_at: 1,
  };
}

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private callback: ResizeObserverCallback) {}
      observe(element: Element) {
        this.callback(
          [
            {
              contentRect: { width: 720 },
              target: element,
            } as ResizeObserverEntry,
          ],
          this as unknown as ResizeObserver,
        );
      }
      unobserve() {}
      disconnect() {}
    },
  );
});

describe("графическая программа", () => {
  it("показывает детали цветного отрезка и редактирует выбранный пункт", async () => {
    const user = userEvent.setup(),
      onEdit = vi.fn(),
      activities = [item(0), item(1)];
    render(
      <ProgramTimeline event={event} activities={activities} onEdit={onEdit} />,
    );
    await user.click(
      screen.getByRole("button", { name: "Лекция 1 · 10:30–11:00" }),
    );
    const detail = screen.getByRole("article", {
      name: "Выбранный пункт программы",
    });
    expect(
      within(detail).getByRole("heading", { name: "Лекция 1" }),
    ).toBeVisible();
    expect(within(detail).getByText("3 занято · 17 свободно")).toBeVisible();
    await user.click(
      within(detail).getByRole("button", {
        name: "Изменить пункт программы Лекция 1",
      }),
    );
    expect(onEdit).toHaveBeenCalledExactlyOnceWith(activities[1]);
    await user.click(
      screen.getByRole("button", { name: "Предыдущий пункт программы" }),
    );
    expect(
      within(detail).getByRole("heading", { name: "Лекция 0" }),
    ).toBeVisible();
  });

  it("раскрывает плотную группу, ограничивает список и находит последний из 1000 пунктов", async () => {
    const user = userEvent.setup();
    const activities = Array.from({ length: 1000 }, (_, index) =>
      item(index, 0.5),
    );
    render(
      <ProgramTimeline
        event={{ ...event, ends_at: event.starts_at + 500 * 60000 }}
        activities={activities}
        onEdit={vi.fn()}
      />,
    );
    const rail = screen.getByRole("group", { name: "Главный зал" });
    expect(within(rail).getAllByRole("button").length).toBeLessThan(20);
    await user.click(within(rail).getAllByRole("button")[0]);
    expect(screen.getAllByRole("listitem")).toHaveLength(8);
    await user.click(
      screen.getByRole("button", { name: "Следующая страница пунктов" }),
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(8);
    await user.click(screen.getByRole("button", { name: "Все пункты дня" }));
    await user.type(
      screen.getByRole("searchbox", { name: "Найти пункт программы" }),
      "Лекция 999",
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    await user.click(within(screen.getByRole("listitem")).getByRole("button"));
    expect(screen.getByRole("article")).toHaveTextContent("Лекция 999");
  });

  it("разделяет группы при увеличении масштаба и возвращается ко всему дню", async () => {
    const user = userEvent.setup(),
      activities = Array.from({ length: 60 }, (_, index) => item(index, 2));
    render(
      <ProgramTimeline
        event={event}
        activities={activities}
        onEdit={vi.fn()}
      />,
    );
    const rail = screen.getByRole("group", { name: "Главный зал" });
    const original = within(rail).getAllByRole("button").length;
    await user.click(
      screen.getByRole("button", { name: "Увеличить масштаб расписания" }),
    );
    expect(within(rail).getAllByRole("button").length).toBeGreaterThan(
      original,
    );
    await user.click(screen.getByRole("button", { name: /Вместить/ }));
    expect(within(rail).getAllByRole("button")).toHaveLength(original);
    expect(
      screen.getByRole("button", { name: "Уменьшить масштаб расписания" }),
    ).toBeDisabled();
  });

  it("фильтрует параллельные аудитории и дни, включая переход через полночь", async () => {
    const user = userEvent.setup();
    const activities = [
      item(0),
      { ...item(1), room_id: "second", room_name: "Малый зал" },
      {
        ...item(2),
        title: "Ночная лекция",
        starts_at: Date.parse("2026-11-12T23:30:00+03:00"),
        ends_at: Date.parse("2026-11-13T00:30:00+03:00"),
      },
    ];
    const multiDay = {
      ...event,
      ends_at: Date.parse("2026-11-14T00:00:00+03:00"),
    };
    render(
      <ProgramTimeline
        event={multiDay}
        activities={activities}
        onEdit={vi.fn()}
      />,
    );
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Аудитория на шкале" }),
      "second",
    );
    expect(
      screen.queryByRole("group", { name: "Главный зал" }),
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Следующий день программы" }),
    );
    expect(screen.getByRole("article")).toHaveTextContent("Ночная лекция");
    expect(
      screen.getByRole("button", { name: "Следующий день программы" }),
    ).toBeDisabled();
    expect(screen.getByLabelText("День программы")).toHaveValue("2026-11-13");
    fireEvent.change(screen.getByLabelText("День программы"), {
      target: { value: "2026-11-12" },
    });
    expect(
      screen.getByRole("button", { name: "Предыдущий день программы" }),
    ).toBeDisabled();
  });
});
