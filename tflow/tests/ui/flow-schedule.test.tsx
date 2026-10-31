import { act, fireEvent, render, screen } from "@testing-library/react";
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
    expect(container.querySelector('[aria-current="step"]')).toHaveAttribute(
      "data-activity-id",
      "one",
    );
    await act(async () => vi.advanceTimersByTime(1020));
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
