import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ProgramGraphEditor } from "../../app/ui/program-graph-editor";
import { event } from "../fixtures";

describe("поля непосредственно на графике", () => {
  it("добавляет онлайн-поток рядом с единственной очной аудиторией", async () => {
    const user = userEvent.setup(), send = vi.fn().mockResolvedValue({ id: "online" });
    render(<ProgramGraphEditor event={{ ...event, format: "Гибрид" }}
      rooms={[{ id: "hall", event_id: event.id, name: "Зал", capacity: 100, is_online: false }]}
      range={{ starts_at: event.starts_at, ends_at: event.starts_at + 30 * 60000 }}
      send={send} refresh={vi.fn()} onPreview={vi.fn()} onDone={vi.fn()} onCancel={vi.fn()} />);
    await user.selectOptions(screen.getByRole("combobox", { name: "Аудитория пункта на графике" }), "@new-online");
    await user.clear(screen.getByRole("textbox", { name: "Название онлайн-потока" }));
    await user.type(screen.getByRole("textbox", { name: "Название онлайн-потока" }), "Общий эфир");
    await user.type(screen.getByRole("textbox", { name: "Название пункта на графике" }), "Трансляция{Enter}");
    await waitFor(() => expect(send).toHaveBeenCalledWith(`events/${event.id}/activities`, "POST",
      expect.objectContaining({ room_id: "", new_room_name: "Общий эфир", online_room: true })));
  });

  it("сохраняет введённое при конфликте и даёт повторить отправку", async () => {
    const user = userEvent.setup(),
      send = vi
        .fn()
        .mockRejectedValueOnce(
          new Error("В этой аудитории уже проходит другая активность"),
        )
        .mockResolvedValue({ id: "created" }),
      refresh = vi.fn(),
      onDone = vi.fn();
    render(
      <ProgramGraphEditor
        event={event}
        rooms={[]}
        range={{
          starts_at: event.starts_at,
          ends_at: event.starts_at + 30 * 60000,
        }}
        send={send}
        refresh={refresh}
        onPreview={vi.fn()}
        onDone={onDone}
        onCancel={vi.fn()}
      />,
    );
    const title = screen.getByRole("textbox", {
      name: "Название пункта на графике",
    });
    await user.type(title, "Моя лекция{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "другая активность",
    );
    expect(title).toHaveValue("Моя лекция");
    expect(screen.getByLabelText("Окончание пункта на графике")).toHaveValue(
      "10:30",
    );
    expect(onDone).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole("button", { name: "Сохранить пункт на графике" }),
    );
    await waitFor(() =>
      expect(onDone).toHaveBeenCalledExactlyOnceWith("created"),
    );
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("сохраняет точные московские дату и минуту для пункта через полночь", async () => {
    const user = userEvent.setup(),
      send = vi.fn().mockResolvedValue({ id: "night" }),
      onDone = vi.fn();
    const starts_at = Date.parse("2026-11-12T23:30:00+03:00"),
      ends_at = Date.parse("2026-11-13T00:30:00+03:00");
    render(
      <ProgramGraphEditor
        event={{
          ...event,
          starts_at: starts_at - 30 * 60000,
          ends_at: ends_at + 90 * 60000,
        }}
        rooms={[]}
        range={{ starts_at, ends_at }}
        send={send}
        refresh={vi.fn()}
        onPreview={vi.fn()}
        onDone={onDone}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Начало пункта на графике")).toHaveValue(
      "2026-11-12T23:30",
    );
    expect(screen.getByLabelText("Окончание пункта на графике")).toHaveValue(
      "2026-11-13T00:30",
    );
    fireEvent.change(screen.getByLabelText("Окончание пункта на графике"), {
      target: { value: "2026-11-13T00:31" },
    });
    await user.type(
      screen.getByRole("textbox", { name: "Название пункта на графике" }),
      "Ночная лекция{Enter}",
    );
    await waitFor(() => expect(onDone).toHaveBeenCalledWith("night"));
    expect(send).toHaveBeenCalledWith(
      `events/${event.id}/activities`,
      "POST",
      expect.objectContaining({ starts_at, ends_at: ends_at + 60000 }),
    );
  });
});

describe("онлайн-флоу в гибридном событии", () => {
  const hybrid = { ...event, format: "Гибрид" };
  const hall = { id: "hall", event_id: event.id, name: "Главный зал", capacity: 100 };

  it("создаёт онлайн-поток прямо на графике при единственной очной аудитории", async () => {
    const user = userEvent.setup(), send = vi.fn().mockResolvedValue({ id: "online" });
    render(<ProgramGraphEditor event={hybrid} rooms={[hall]}
      range={{ starts_at: event.starts_at, ends_at: event.ends_at, room_id: hall.id }}
      send={send} refresh={vi.fn()} onPreview={vi.fn()} onDone={vi.fn()} onCancel={vi.fn()}/>);
    await user.selectOptions(screen.getByRole("combobox", { name: "Аудитория пункта на графике" }),
      screen.getByRole("option", { name: "Создать онлайн-поток" }));
    expect(screen.getByRole("textbox", { name: "Название онлайн-потока" })).toHaveValue("Онлайн-поток 1");
    await user.type(screen.getByRole("textbox", { name: "Название пункта на графике" }), "Онлайн-лекция");
    await user.click(screen.getByRole("button", { name: "Сохранить пункт на графике" }));
    await waitFor(() => expect(send).toHaveBeenCalledWith(`events/${event.id}/activities`, "POST",
      expect.objectContaining({ room_id: "", online_room: true, new_room_name: "Онлайн-поток 1", new_room_capacity: event.capacity })));
  });

  it("позволяет выбрать существующую онлайн-аудиторию и учитывает её вместимость", async () => {
    const user = userEvent.setup(), send = vi.fn().mockResolvedValue({ id: "online" });
    render(<ProgramGraphEditor event={hybrid} rooms={[hall, { ...hall, id: "video", name: "Django", is_online: true, capacity: 20 }]}
      range={{ starts_at: event.starts_at, ends_at: event.ends_at }}
      send={send} refresh={vi.fn()} onPreview={vi.fn()} onDone={vi.fn()} onCancel={vi.fn()}/>);
    await user.selectOptions(screen.getByRole("combobox", { name: "Аудитория пункта на графике" }),
      screen.getByRole("option", { name: "Онлайн · Django" }));
    await user.type(screen.getByRole("textbox", { name: "Название пункта на графике" }), "Практикум");
    await user.click(screen.getByRole("button", { name: "Сохранить пункт на графике" }));
    await waitFor(() => expect(send).toHaveBeenCalledWith(expect.any(String), "POST",
      expect.objectContaining({ room_id: "video", online_room: true, capacity: 20 })));
    expect(send.mock.calls[0][2]).not.toHaveProperty("new_room_name");
  });
});
