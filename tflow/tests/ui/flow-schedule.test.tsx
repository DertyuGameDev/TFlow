import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
      screen.getAllByRole("heading", { level: 4 }).map((el) => el.textContent),
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
    const titles = screen.getAllByRole("heading", { level: 4 });
    expect(titles).toHaveLength(160);
    expect(titles[0]).toHaveTextContent("Пункт 0");
    expect(titles[159]).toHaveTextContent("Пункт 159");
    expect(screen.getAllByRole("heading", { level: 3 }).length).toBeGreaterThan(
      1,
    );
  });
});
