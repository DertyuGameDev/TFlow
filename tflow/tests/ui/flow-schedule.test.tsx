import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { FlowSchedule, useFlowClock } from "../../app/ui/flow-schedule";
import type { Activity } from "../../lib/types";
import { event } from "../fixtures";

const item = {
  id: "one",
  event_id: event.id,
  room_id: "main",
  title: "Доклад",
  starts_at: event.starts_at,
  ends_at: event.starts_at + 30 * 60000,
} as Activity;
function ClockFlow({ activities }: { activities: Activity[] }) {
  const now = useFlowClock(activities);
  return (
    <FlowSchedule
      activities={activities}
      now={now}
      renderActivity={(a) => <h4>{a.title}</h4>}
    />
  );
}
afterEach(() => vi.useRealTimers());

describe("общая вертикальная линия флоу", () => {
  it("сохраняет разные цвета активностей одного зала при начале эфира и фильтрации", () => {
    const activities = Array.from({ length: 3 }, (_, index) => ({
      ...item,
      id: `activity-${index}`,
      title: `Встреча ${index}`,
    }));
    const renderFlow = (visible: Activity[], now: number) => (
      <FlowSchedule activities={visible} now={now} renderActivity={() => null} />
    );
    const { container, rerender } = render(renderFlow(activities, item.starts_at - 1));
    const colors = () => new Map(Array.from(container.querySelectorAll<HTMLElement>(".flow-event"), node => [
      node.dataset.activityId, node.style.getPropertyValue("--flow-color"),
    ]));
    const original = colors();
    expect(new Set(original.values()).size).toBe(3);

    rerender(renderFlow([...activities].reverse(), item.starts_at));
    expect(colors()).toEqual(original);
    const current = screen.getByRole("list", { name: "Текущие активности" });
    for (const activity of activities) {
      expect(within(current).getByRole("button", { name: `Открыть активность ${activity.title}` })).toHaveStyle({
        "--flow-color": original.get(activity.id),
      });
    }

    rerender(renderFlow([activities[1]], item.ends_at));
    expect(colors().get(activities[1].id)).toBe(original.get(activities[1].id));
  });

  it("показывает время на линии по МСК и обновляет цифры без перезагрузки", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(item.starts_at + 59_000);
    const { container } = render(<ClockFlow activities={[item]} />);
    const time = screen.getByLabelText("Сейчас 10:00, МСК");
    expect(time).toBeVisible();
    expect(time).toHaveTextContent("10:00");
    expect(time).toHaveAttribute("datetime", new Date(item.starts_at + 59_000).toISOString());
    expect(container.querySelector(".flow-time-tick.is-near-now")).toBeInTheDocument();

    await act(async () => vi.advanceTimersByTime(1_020));
    expect(screen.getByLabelText("Сейчас 10:01, МСК")).toHaveTextContent("10:01");
  });

  it("показывает в списке только текущие параллельные активности и открывает их действия", async () => {
    const user = userEvent.setup();
    render(
      <FlowSchedule
        activities={[
          item,
          { ...item, id: "parallel", title: "Эфир", room_name: "Онлайн" },
          { ...item, id: "past", title: "Прошедшее", ends_at: item.starts_at },
          {
            ...item,
            id: "future",
            title: "Будущее",
            starts_at: item.ends_at,
            ends_at: item.ends_at + 60000,
          },
        ]}
        now={item.starts_at}
        renderActivity={(a) => <button>Записаться на {a.title}</button>}
      />,
    );
    const list = screen.getByRole("list", { name: "Текущие активности" });
    expect(within(list).getAllByRole("button")).toHaveLength(2);
    expect(within(list).queryByText("Прошедшее")).not.toBeInTheDocument();
    expect(within(list).queryByText("Будущее")).not.toBeInTheDocument();
    const link = within(list).getByRole("button", {
      name: "Открыть активность Эфир",
    });
    link.focus();
    await user.keyboard("{Enter}");
    expect(link).toHaveAttribute("aria-expanded", "true");
    expect(
      within(
        screen.getByRole("region", { name: "Сведения об активности" }),
      ).getByRole("button", { name: "Записаться на Эфир" }),
    ).toBeVisible();
    expect(
      screen.getByRole("region", { name: "Сведения об активности" }),
    ).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(link).toHaveFocus();
    expect(
      screen.queryByRole("region", { name: "Сведения об активности" }),
    ).not.toBeInTheDocument();
  });

  it("показывает понятное пустое состояние до начала и после завершения программы", () => {
    const { rerender } = render(
      <FlowSchedule
        activities={[item]}
        now={item.starts_at - 1}
        renderActivity={() => null}
      />,
    );
    expect(screen.getByText("Сейчас активностей нет")).toBeVisible();
    expect(screen.getByText(/Следующая —/)).toBeVisible();
    rerender(
      <FlowSchedule
        activities={[item]}
        now={item.ends_at}
        renderActivity={() => null}
      />,
    );
    expect(screen.getByText("Сейчас активностей нет")).toBeVisible();
    expect(screen.queryByText(/Следующая —/)).not.toBeInTheDocument();
  });
  it("не закрывает подробности при начале свайпа за пределами плашки, но закрывает при отдельном нажатии", async () => {
    const user = userEvent.setup();
    render(
      <FlowSchedule
        activities={[item]}
        now={0}
        renderActivity={(a) => <h4>{a.title}</h4>}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Доклад 30 мин" }));
    fireEvent.pointerDown(document.body, {
      pointerType: "touch",
      clientY: 400,
    });
    fireEvent.pointerMove(document.body, {
      pointerType: "touch",
      clientY: 200,
    });
    expect(
      screen.getByRole("region", { name: "Сведения об активности" }),
    ).toBeVisible();
    fireEvent.click(document.body);
    expect(
      screen.queryByRole("region", { name: "Сведения об активности" }),
    ).not.toBeInTheDocument();
  });
  it("открывает минутную активность по заметной плашке и возвращает на неё фокус", async () => {
    const user = userEvent.setup();
    render(
      <FlowSchedule
        activities={[{ ...item, ends_at: item.starts_at + 60000 }]}
        now={0}
        renderActivity={(a) => <h4>{a.title}</h4>}
      />,
    );
    const marker = screen.getByRole("button", { name: "Доклад 1 мин" });
    await user.click(marker);
    expect(
      screen.getByRole("region", { name: "Сведения об активности" }),
    ).toBeVisible();
    expect(screen.getByRole("heading", { name: "Доклад" })).toBeVisible();
    await user.keyboard("{Escape}");
    expect(
      screen.queryByRole("region", { name: "Сведения об активности" }),
    ).not.toBeInTheDocument();
    expect(marker).toHaveFocus();
  });

  it("даёт выбрать каждый из соседних минутных пунктов и вернуться к списку", async () => {
    const user = userEvent.setup();
    render(
      <FlowSchedule
        activities={Array.from({ length: 3 }, (_, i) => ({
          ...item,
          id: `short-${i}`,
          title: `Минутный пункт ${i + 1}`,
          starts_at: item.starts_at + i * 60000,
          ends_at: item.starts_at + (i + 1) * 60000,
        }))}
        now={0}
        renderActivity={(a) => <h4>{a.title}</h4>}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "Короткие активности: 3" }),
    );
    expect(
      screen.getByRole("button", { name: /Минутный пункт 1/ }),
    ).toHaveFocus();
    await user.click(screen.getByRole("button", { name: /Минутный пункт 2/ }));
    expect(
      screen.getByRole("heading", { name: "Минутный пункт 2" }),
    ).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: "Назад к коротким активностям" }),
    );
    expect(
      screen.getByRole("button", { name: /Минутный пункт 1/ }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: /Минутный пункт 3/ }),
    ).toBeVisible();
  });
  it("выделяет все текущие параллельные активности, не выделяя завершённые", () => {
    const activities = [
      item,
      { ...item, id: "online", room_id: "online", title: "Эфир" },
      { ...item, id: "past", ends_at: item.starts_at },
    ];
    const { container } = render(
      <FlowSchedule
        activities={activities}
        now={item.starts_at + 1000}
        renderActivity={(a) => <h4>{a.title}</h4>}
      />,
    );
    expect(container.querySelectorAll('[aria-current="step"]')).toHaveLength(2);
    expect(
      container.querySelector('[data-activity-id="past"]'),
    ).not.toHaveAttribute("aria-current");
    expect(
      screen.getByRole("list", { name: "Флоу мероприятия" }),
    ).toBeVisible();
  });

  it("автоматически переключает текущее событие на границе времени без перезагрузки", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(item.ends_at - 1000);
    const second = {
      ...item,
      id: "two",
      title: "Практика",
      starts_at: item.ends_at,
      ends_at: event.ends_at,
    };
    const { container } = render(<ClockFlow activities={[second, item]} />);
    expect(
      within(
        screen.getByRole("list", { name: "Текущие активности" }),
      ).getByRole("button", { name: "Открыть активность Доклад" }),
    ).toBeVisible();
    expect(container.querySelector('[aria-current="step"]')).toHaveAttribute(
      "data-activity-id",
      "one",
    );
    await act(async () => vi.advanceTimersByTime(1020));
    const current = screen.getByRole("list", { name: "Текущие активности" });
    expect(
      within(current).queryByRole("button", {
        name: "Открыть активность Доклад",
      }),
    ).not.toBeInTheDocument();
    expect(
      within(current).getByRole("button", {
        name: "Открыть активность Практика",
      }),
    ).toBeVisible();
    expect(container.querySelector('[aria-current="step"]')).toHaveAttribute(
      "data-activity-id",
      "two",
    );
    expect(
      screen
        .getAllByRole("heading", { name: /^(Доклад|Практика)$/ })
        .map((el) => el.textContent),
    ).toEqual(["Доклад", "Практика"]);
  });

  it("вмещает длинную программу с несколькими днями, сохраняя порядок", () => {
    const activities = Array.from({ length: 160 }, (_, i) => ({
      ...item,
      id: String(i),
      title: `Пункт ${i}`,
      starts_at: item.starts_at + i * 20 * 60000,
      ends_at: item.starts_at + (i * 20 + 15) * 60000,
    }));
    render(
      <FlowSchedule
        activities={[...activities].reverse()}
        now={0}
        renderActivity={(a) => <h4>{a.title}</h4>}
      />,
    );
    const titles = screen.getAllByRole("heading", { name: /^Пункт / });
    expect(titles).toHaveLength(160);
    expect(titles[0]).toHaveTextContent("Пункт 0");
    expect(titles[159]).toHaveTextContent("Пункт 159");
    expect(screen.getAllByRole("heading", { level: 3 }).length).toBeGreaterThan(
      1,
    );
  });
});
