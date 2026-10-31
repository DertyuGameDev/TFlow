import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProgramTimeline } from "../../app/ui/program-timeline";
import type { Activity } from "../../lib/types";
import { deferred, event } from "../fixtures";

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
    "PointerEvent",
    class extends MouseEvent {
      pointerId: number;
      isPrimary: boolean;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 1;
        this.isPrimary = init.isPrimary ?? true;
      }
    },
  );
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

function measureCanvas(container: HTMLElement) {
  vi.spyOn(
    container.querySelector(".timeline-canvas")!,
    "getBoundingClientRect",
  ).mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 600,
    bottom: 200,
    width: 600,
    height: 200,
    toJSON() {},
  });
}
function drag(target: HTMLElement, from: number, to: number, finish = true) {
  fireEvent.pointerDown(target, { button: 0, pointerId: 1, clientX: from });
  fireEvent.pointerMove(target, { pointerId: 1, clientX: to });
  if (finish) fireEvent.pointerUp(target, { pointerId: 1, clientX: to });
}

describe("действия на графике программы", () => {
  it("изменяет время по минуте без увеличения графика и при масштабе ×2", async () => {
    const user = userEvent.setup(),
      onReschedule = vi.fn().mockResolvedValue(undefined),
      activity = item(0);
    render(
      <ProgramTimeline
        event={event}
        activities={[activity]}
        onEdit={vi.fn()}
        onReschedule={onReschedule}
      />,
    );
    const handle = screen.getByRole("button", {
      name: "Изменить окончание Лекция 0",
    });
    await user.click(handle);
    await user.keyboard("{ArrowRight}");
    await waitFor(() => expect(onReschedule).toHaveBeenCalledTimes(1));
    expect(onReschedule).toHaveBeenLastCalledWith(activity, {
      starts_at: activity.starts_at,
      ends_at: activity.ends_at + 60000,
    });
    await user.click(
      screen.getByRole("button", { name: "Увеличить масштаб расписания" }),
    );
    await user.click(handle);
    await user.keyboard("{ArrowRight}");
    await waitFor(() => expect(onReschedule).toHaveBeenCalledTimes(2));
    expect(onReschedule).toHaveBeenLastCalledWith(activity, {
      starts_at: activity.starts_at,
      ends_at: activity.ends_at + 60000,
    });
  });

  it("создаёт пункт выделением интервала даже на пустом графике и передаёт выбранную аудиторию", () => {
    const onCreate = vi.fn();
    const { container } = render(
      <ProgramTimeline
        event={event}
        activities={[]}
        rooms={[
          {
            id: "main",
            event_id: event.id,
            name: "Главный зал",
            capacity: 100,
          },
        ]}
        onEdit={vi.fn()}
        onCreate={onCreate}
      />,
    );
    measureCanvas(container);
    const track = screen.getByRole("button", {
      name: "Добавить пункт на шкале",
    });
    drag(track, 300, 150);
    expect(onCreate).toHaveBeenCalledExactlyOnceWith({
      starts_at: event.starts_at + 30 * 60000,
      ends_at: event.starts_at + 60 * 60000,
      room_id: "main",
    });
    fireEvent.click(track, { detail: 0 });
    expect(onCreate).toHaveBeenLastCalledWith({
      starts_at: event.starts_at,
      ends_at: event.starts_at + 30 * 60000,
      room_id: "main",
    });
  });
  it("показывает растягивание сразу и сохраняет ровно один раз после отпускания", async () => {
    const activity = item(0),
      sending = deferred<void>(),
      onReschedule = vi.fn(() => sending.promise);
    const { container } = render(
      <ProgramTimeline
        event={event}
        activities={[activity]}
        onEdit={vi.fn()}
        onReschedule={onReschedule}
      />,
    );
    measureCanvas(container);
    const handle = screen.getByRole("button", {
      name: "Изменить окончание Лекция 0",
    });
    drag(handle, 150, 225, false);
    expect(screen.getByRole("status")).toHaveTextContent("10:00–10:45");
    expect(onReschedule).not.toHaveBeenCalled();
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 225 });
    expect(onReschedule).toHaveBeenCalledExactlyOnceWith(activity, {
      starts_at: activity.starts_at,
      ends_at: event.starts_at + 45 * 60000,
    });
    expect(handle).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Сохраняем");
    await act(async () => sending.resolve());
    expect(screen.getByRole("status")).toHaveTextContent("сохранено");
  });
  it("отменяет жест через Esc и отмену касания, а нажатие края без перемещения ничего не сохраняет", () => {
    const onReschedule = vi.fn();
    const { container } = render(
      <ProgramTimeline
        event={event}
        activities={[item(0)]}
        onEdit={vi.fn()}
        onReschedule={onReschedule}
      />,
    );
    measureCanvas(container);
    const handle = screen.getByRole("button", {
      name: "Изменить окончание Лекция 0",
    });
    drag(handle, 150, 225, false);
    fireEvent.pointerCancel(handle, { pointerId: 2 });
    expect(screen.getByRole("status")).toHaveTextContent("10:00–10:45");
    fireEvent.keyDown(handle, { key: "Escape" });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 225 });
    drag(handle, 150, 225, false);
    fireEvent.pointerCancel(handle, { pointerId: 1 });
    drag(handle, 150, 150);
    expect(onReschedule).not.toHaveBeenCalled();
    expect(screen.getByRole("article")).toHaveTextContent("10:00–10:30");
  });
  it("не сохраняет пересечение в аудитории и возвращает исходное время при ошибке сервера", async () => {
    const onReschedule = vi
      .fn()
      .mockRejectedValue(new Error("Перенос создаёт пересечение у участников"));
    const { container, rerender } = render(
      <ProgramTimeline
        event={event}
        activities={[item(0), item(1)]}
        onEdit={vi.fn()}
        onReschedule={onReschedule}
      />,
    );
    measureCanvas(container);
    drag(
      screen.getByRole("button", { name: "Изменить окончание Лекция 0" }),
      150,
      225,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Лекция 1");
    expect(onReschedule).not.toHaveBeenCalled();
    rerender(
      <ProgramTimeline
        event={event}
        activities={[item(0)]}
        onEdit={vi.fn()}
        onReschedule={onReschedule}
      />,
    );
    drag(
      screen.getByRole("button", { name: "Изменить окончание Лекция 0" }),
      150,
      225,
    );
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "пересечение у участников",
      ),
    );
    expect(screen.getByRole("article")).toHaveTextContent("10:00–10:30");
  });
  it("даёт редактировать пункт из плотной группы и поддерживает клавиатуру", async () => {
    const onReschedule = vi.fn().mockResolvedValue(undefined);
    render(
      <ProgramTimeline
        event={event}
        activities={Array.from({ length: 60 }, (_, index) => item(index, 2))}
        onEdit={vi.fn()}
        onReschedule={onReschedule}
      />,
    );
    expect(
      screen.getByRole("group", { name: "Редактирование: Главный зал" }),
    ).toBeInTheDocument();
    const handle = screen.getByRole("button", {
      name: "Изменить окончание Лекция 0",
    });
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    await waitFor(() => expect(onReschedule).toHaveBeenCalledOnce());
    expect(onReschedule.mock.calls[0][1]).toEqual({
      starts_at: event.starts_at,
      ends_at: event.starts_at + 60000,
    });
  });
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
