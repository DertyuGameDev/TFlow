import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { QuickEventForm } from "../../app/ui/quick-event-form";
import { event } from "../fixtures";

async function describeEvent(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Название события"), "Новая встреча");
  await user.type(screen.getByRole("combobox", { name: "Категория" }), "Разработка{Enter}");
  await user.click(screen.getByRole("button", { name: /Далее: время и место/ }));
}

describe("создание и перенос события", () => {
  it("принимает однобуквенные название и описание и вместимость больше прежнего максимума", async () => {
    const user = userEvent.setup(), send = vi.fn().mockResolvedValue({ id: "simple-event" });
    render(<QuickEventForm send={send} done={vi.fn()} initialStart={event.starts_at} />);
    const title = screen.getByLabelText("Название события");
    expect(title).not.toHaveAttribute("minlength");
    expect(title).not.toHaveAttribute("maxlength");
    await user.type(title, "А");
    await user.type(screen.getByRole("combobox", { name: "Категория" }), "Разработка{Enter}");
    await user.type(screen.getByRole("textbox", { name: /Коротко о событии/ }), "О");
    await user.click(screen.getByRole("button", { name: /Далее: время и место/ }));
    await user.click(screen.getByRole("radio", { name: "Онлайн" }));
    const capacity = screen.getByRole("spinbutton");
    expect(capacity).not.toHaveAttribute("max");
    fireEvent.change(capacity, { target: { value: "500001" } });
    await user.click(screen.getByRole("button", { name: "Создать черновик" }));
    await waitFor(() => expect(send).toHaveBeenCalledWith("events", "POST", expect.objectContaining({
      title: "А", description: "О", capacity: 500001,
    })));
  });

  it("не переходит к месту и не отправляет пустую форму", async () => {
    const user = userEvent.setup(), send = vi.fn();
    render(<QuickEventForm send={send} done={vi.fn()} initialStart={event.starts_at} />);
    await user.click(screen.getByRole("button", { name: /Далее: время и место/ }));
    expect(screen.getByRole("group", { name: "Расскажите о событии" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Создать черновик" })).not.toBeInTheDocument();
    expect(send).not.toHaveBeenCalled();
  });

  it("создаёт онлайн-событие без физической площадки и возвращает его id", async () => {
    const user = userEvent.setup(), send = vi.fn().mockResolvedValue({ id: "new-event" }), done = vi.fn();
    render(<QuickEventForm send={send} done={done} initialStart={event.starts_at} />);
    await describeEvent(user);
    await user.click(screen.getByRole("radio", { name: "Онлайн" }));
    expect(screen.queryByRole("textbox", { name: "Площадка" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Создать черновик" }));
    await waitFor(() => expect(done).toHaveBeenCalledWith("new-event"));
    expect(send).toHaveBeenCalledExactlyOnceWith("events", "POST", expect.objectContaining({
      title: "Новая встреча", format: "Онлайн", city: "Онлайн", venue: "Вебинар на ТФлоу", address: "",
      starts_at: event.starts_at, ends_at: event.ends_at, capacity: 100, topic: "Разработка",
      description: "Информация о мероприятии «Новая встреча».",
    }));
  });

  it("сдвигает окончание вместе с началом, сохраняя длительность по Москве", async () => {
    const user = userEvent.setup();
    render(<QuickEventForm send={vi.fn()} done={vi.fn()} initialStart={event.starts_at} />);
    await describeEvent(user);
    fireEvent.change(screen.getByLabelText("Начало · МСК"), { target: { value: "2026-11-13T23:30" } });
    expect(screen.getByLabelText("Окончание · МСК")).toHaveValue("2026-11-14T01:30");
  });

  it("сохраняет адрес при переключении форматов и редактирует прежнее событие", async () => {
    const user = userEvent.setup(), send = vi.fn().mockResolvedValue({});
    render(<QuickEventForm event={event} send={send} done={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /Далее: время и место/ }));
    await user.click(screen.getByRole("radio", { name: "Онлайн" }));
    await user.click(screen.getByRole("radio", { name: "Гибрид" }));
    expect(screen.getByRole("textbox", { name: "Площадка" })).toHaveValue(event.venue);
    expect(screen.getByRole("textbox", { name: /Адрес/ })).toHaveValue(event.address);
    await user.click(screen.getByRole("button", { name: /Сохранить/ }));
    await waitFor(() => expect(send).toHaveBeenCalledWith(`events/${event.id}`, "PATCH", expect.objectContaining({
      format: "Гибрид", city: "Москва", address: event.address, venue: event.venue, capacity: event.capacity,
    })));
  });

  it("перенос отправляет только новое время и место", async () => {
    const user = userEvent.setup(), send = vi.fn().mockResolvedValue({}), done = vi.fn();
    render(<QuickEventForm event={event} move send={send} done={done} />);
    expect(screen.queryByLabelText("Название события")).not.toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "Площадка" }), " — другой зал");
    await user.click(screen.getByRole("button", { name: /Перенести/ }));
    await waitFor(() => expect(done).toHaveBeenCalledWith(event.id));
    const payload = send.mock.calls[0][2];
    expect(send.mock.calls[0].slice(0, 2)).toEqual([`events/${event.id}/move`, "PATCH"]);
    expect(Object.keys(payload).sort()).toEqual(["address", "city", "ends_at", "starts_at", "venue"]);
  });

  it("ошибка сети сохраняет введённые данные и позволяет повторить отправку", async () => {
    const user = userEvent.setup(), done = vi.fn();
    const send = vi.fn().mockRejectedValueOnce(new Error("Сервер временно недоступен")).mockResolvedValue({ id: "retry-event" });
    render(<QuickEventForm send={send} done={done} initialStart={event.starts_at} />);
    await describeEvent(user);
    await user.click(screen.getByRole("radio", { name: "Онлайн" }));
    await user.click(screen.getByRole("button", { name: "Создать черновик" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Сервер временно недоступен");
    expect(done).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Назад" }));
    expect(screen.getByLabelText("Название события")).toHaveValue("Новая встреча");
    await user.click(screen.getByRole("button", { name: /Далее: время и место/ }));
    await user.click(screen.getByRole("button", { name: "Создать черновик" }));
    await waitFor(() => expect(done).toHaveBeenCalledWith("retry-event"));
    expect(send).toHaveBeenCalledTimes(2);
  });
});
