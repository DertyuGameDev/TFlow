import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ActivityForm } from "../../app/ui/program-item-form";
import { event } from "../fixtures";

describe("пункты программы", () => {
  it("принимает короткое название и наследует вместимость без ограничения в 10000", async () => {
    const user = userEvent.setup(),
      send = vi.fn().mockResolvedValue({ id: "large-item" });
    render(
      <ActivityForm
        event={{ ...event, capacity: 500001 }}
        rooms={[]}
        send={send}
        done={vi.fn()}
      />,
    );
    const title = screen.getByLabelText("Название пункта программы");
    expect(title).not.toHaveAttribute("minlength");
    expect(title).not.toHaveAttribute("maxlength");
    await user.type(title, "А");
    expect(screen.getByLabelText("Лимит мест")).toHaveValue(500001);
    await user.click(
      screen.getByRole("button", { name: "Добавить в программу" }),
    );
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith(
        `events/${event.id}/activities`,
        "POST",
        expect.objectContaining({
          title: "А",
          capacity: 500001,
        }),
      ),
    );
  });

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

  it("предлагает отдельный онлайн-поток рядом с очными аудиториями", async () => {
    const user = userEvent.setup(),
      send = vi.fn().mockResolvedValue({ id: "online" });
    render(
      <ActivityForm
        event={event}
        rooms={[
          {
            id: "hall",
            event_id: event.id,
            name: "Большой зал",
            capacity: 100,
          },
        ]}
        send={send}
        done={vi.fn()}
      />,
    );
    await user.type(
      screen.getByLabelText("Название пункта программы"),
      "Онлайн-лекция",
    );
    await user.selectOptions(
      screen.getByLabelText("Аудитория"),
      screen.getByRole("option", { name: "Онлайн · Вебинар внутри ТФлоу" }),
    );
    expect(screen.getByText(/Может идти одновременно/)).toHaveTextContent(
      "Событие станет гибридным",
    );
    expect(screen.getByLabelText("Лимит зрителей")).toHaveValue(100);
    await user.click(
      screen.getByRole("button", { name: "Добавить в программу" }),
    );
    await waitFor(() => expect(send).toHaveBeenCalledOnce());
    expect(send).toHaveBeenCalledWith(
      `events/${event.id}/activities`,
      "POST",
      expect.objectContaining({
        room_id: "",
        online_room: true,
        starts_at: event.starts_at,
      }),
    );
  });

  it("не возвращает старый потолок мест для новой онлайн-аудитории", () => {
    render(
      <ActivityForm
        event={{ ...event, format: "Онлайн", capacity: 50000 }}
        rooms={[]}
        send={vi.fn()}
        done={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Лимит зрителей")).toHaveValue(50000);
    expect(screen.getByLabelText("Лимит зрителей")).toHaveAttribute(
      "max",
      "50000",
    );
  });

  it("повторно использует онлайн-аудиторию и её лимит без второго варианта в списке", async () => {
    const user = userEvent.setup(),
      send = vi.fn().mockResolvedValue({});
    render(
      <ActivityForm
        event={{ ...event, format: "Онлайн" }}
        rooms={[
          {
            id: "virtual",
            event_id: event.id,
            name: "Наш эфир",
            capacity: 25,
            is_online: true,
          },
        ]}
        send={send}
        done={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Аудитория")).toHaveValue("virtual");
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByLabelText("Лимит зрителей")).toHaveValue(25);
    await user.type(
      screen.getByLabelText("Название пункта программы"),
      "Следующий эфир",
    );
    await user.click(
      screen.getByRole("button", { name: "Добавить в программу" }),
    );
    await waitFor(() => expect(send).toHaveBeenCalledOnce());
    expect(send).toHaveBeenCalledWith(
      expect.any(String),
      "POST",
      expect.objectContaining({
        room_id: "virtual",
        online_room: true,
        capacity: 25,
      }),
    );
  });
});
