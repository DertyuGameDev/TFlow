import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ActivityForm } from "../../app/ui/program-item-form";
import { event } from "../fixtures";

describe("пункты программы", () => {
  it("добавляет первый пункт одним запросом без предварительного создания аудитории", async () => {
    const user = userEvent.setup(),
      send = vi.fn().mockResolvedValue({ id: "item" }),
      done = vi.fn();
    render(<ActivityForm event={event} rooms={[]} send={send} done={done} />);
    await user.type(
      screen.getByLabelText("Название пункта программы"),
      "Открытие встречи",
    );
    await user.click(
      screen.getByRole("button", { name: "Добавить в программу" }),
    );
    await waitFor(() => expect(done).toHaveBeenCalledOnce());
    expect(send).toHaveBeenCalledExactlyOnceWith(
      `events/${event.id}/activities`,
      "POST",
      expect.objectContaining({
        title: "Открытие встречи",
        room_id: "",
        starts_at: event.starts_at,
        ends_at: event.starts_at + 3600000,
        capacity: 100,
      }),
    );
  });

  it("предлагает следующее время и сохраняет длительность в пределах мероприятия", () => {
    render(
      <ActivityForm
        event={event}
        rooms={[]}
        initialStart={event.starts_at + 3600000}
        send={vi.fn()}
        done={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Начало · МСК")).toHaveValue(
      "2026-11-12T11:00",
    );
    fireEvent.change(screen.getByLabelText("Начало · МСК"), {
      target: { value: "2026-11-12T11:30" },
    });
    expect(screen.getByLabelText("Окончание · МСК")).toHaveValue(
      "2026-11-12T12:00",
    );
    fireEvent.change(screen.getByLabelText("Окончание · МСК"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByLabelText("Начало · МСК"), {
      target: { value: "2026-11-12T10:00" },
    });
    expect(screen.getByLabelText("Окончание · МСК")).toHaveValue("");
  });

  it("сохраняет заполнение при конфликте и не вызывает done", async () => {
    const user = userEvent.setup(),
      done = vi.fn(),
      send = vi
        .fn()
        .mockRejectedValue(
          new Error("В аудитории уже проходит другая активность"),
        );
    render(<ActivityForm event={event} rooms={[]} send={send} done={done} />);
    await user.type(
      screen.getByLabelText("Название пункта программы"),
      "Вторая лекция",
    );
    await user.click(
      screen.getByRole("button", { name: "Добавить в программу" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "В аудитории уже проходит другая активность",
    );
    expect(screen.getByLabelText("Название пункта программы")).toHaveValue(
      "Вторая лекция",
    );
    expect(done).not.toHaveBeenCalled();
  });

  it("снижает лимит мест при выборе меньшей аудитории", async () => {
    const user = userEvent.setup();
    render(
      <ActivityForm
        event={event}
        rooms={[
          { id: "big", event_id: event.id, name: "Большой зал", capacity: 100 },
          { id: "small", event_id: event.id, name: "Малый зал", capacity: 10 },
        ]}
        send={vi.fn()}
        done={vi.fn()}
      />,
    );
    await user.selectOptions(screen.getByLabelText("Аудитория"), "small");
    expect(screen.getByLabelText("Лимит мест")).toHaveValue(10);
    expect(screen.getByLabelText("Лимит мест")).toHaveAttribute("max", "10");
  });
});
