import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TFlow } from "../../app/tflow";
import type { Activity, UserIdentity } from "../../lib/types";
import { event, profile } from "../fixtures";

const host: UserIdentity = {
  userId: event.owner_id,
  displayName: "Организатор",
  email: "host@example.test",
  fullName: "Организатор",
  role: "organizer",
};
const first: Activity = {
  id: "lecture",
  event_id: event.id,
  room_id: "main",
  room_name: "Главный зал",
  title: "Лекция",
  description: "",
  speaker: "",
  starts_at: event.starts_at,
  ends_at: event.starts_at + 30 * 60000,
  capacity: 50,
  taken: 0,
  registered: 0,
  waiting_count: 0,
  waitlisted: 0,
  waitlist_position: 0,
  updated_at: 1,
};
beforeEach(() => {
  history.replaceState({}, "", `/#manage/${event.id}/program`);
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});
afterEach(() => history.replaceState({}, "", "/"));

function server() {
  let activities = [{ ...first }];
  const writes: { path: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = url.replace("/api/", "");
      if (init?.method === "PATCH" || init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        writes.push({ path, body });
        if (path === `activities/${first.id}`)
          activities = activities.map((item) =>
            path === `activities/${item.id}`
              ? { ...item, ...body, updated_at: item.updated_at + 1 }
              : item,
          );
        else activities.push({ ...first, ...body, id: "created" });
        return new Response(JSON.stringify({ id: "created" }), {
          status: init.method === "POST" ? 201 : 200,
        });
      }
      if (path.endsWith("/attendance")) return new Response("[]");
      const currentEvent = { ...event, activity_count: activities.length };
      if (path === `events/${event.id}`)
        return new Response(
          JSON.stringify({
            event: currentEvent,
            activities,
            rooms: [
              {
                id: "main",
                event_id: event.id,
                name: "Главный зал",
                capacity: 100,
              },
              {
                id: "second",
                event_id: event.id,
                name: "Малый зал",
                capacity: 60,
              },
            ],
          }),
        );
      return new Response(
        JSON.stringify({
          events: [currentEvent],
          tickets: [],
          schedule: [],
          waitlist: [],
          communities: [],
          notifications: [],
          unread_notification_count: 0,
          profile: { ...profile, id: host.userId, role: "organizer" },
        }),
      );
    }),
  );
  return writes;
}

describe("программа списком с открытой формой", () => {
  it("сразу показывает аудитории, список и форму; после добавления готова форма следующего пункта", async () => {
    const writes = server(),
      user = userEvent.setup();
    render(<TFlow user={host} />);
    const editor = await screen.findByRole("region", {
      name: "Добавить пункт программы",
    });
    const list = screen.getByRole("region", {
      name: "Список пунктов программы",
    });
    const rooms = screen.getByRole("heading", { name: "Аудитории", level: 2 });
    expect(
      rooms.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      list.compareDocumentPosition(editor) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      screen.queryByRole("region", { name: "Графическое расписание" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(within(list).getByRole("heading", { name: "Лекция" })).toBeVisible();
    await user.type(
      within(editor).getByLabelText("Название пункта программы"),
      "Новая лекция",
    );
    await user.click(
      within(editor).getByRole("button", { name: "Добавить в программу" }),
    );
    await within(list).findByRole("heading", { name: "Новая лекция" });
    const ready = screen.getByRole("region", {
      name: "Добавить пункт программы",
    });
    expect(
      within(ready).getByLabelText("Название пункта программы"),
    ).toHaveValue("");
    expect(within(ready).getByLabelText("Начало · МСК")).toHaveValue(
      "2026-11-12T11:30",
    );
    expect(writes[0]).toEqual({
      path: `events/${event.id}/activities`,
      body: expect.objectContaining({
        title: "Новая лекция",
        starts_at: first.ends_at,
        ends_at: first.ends_at + 3600000,
      }),
    });
  });

  it("редактирует строку с точностью до минуты и возвращается к открытой форме добавления", async () => {
    const writes = server(),
      user = userEvent.setup();
    render(<TFlow user={host} />);
    await user.click(
      await screen.findByRole("button", {
        name: "Изменить пункт программы Лекция",
      }),
    );
    const editor = screen.getByRole("region", {
      name: "Изменить пункт программы",
    });
    const title = within(editor).getByLabelText("Название пункта программы");
    await user.clear(title);
    await user.type(title, "Новое название");
    fireEvent.change(within(editor).getByLabelText("Окончание · МСК"), {
      target: { value: "2026-11-12T10:31" },
    });
    await user.selectOptions(
      within(editor).getByLabelText("Аудитория"),
      "second",
    );
    await act(async () => fireEvent.focus(window));
    expect(within(editor).getByLabelText("Аудитория")).toHaveValue("second");
    expect(title).toHaveValue("Новое название");
    await user.click(
      within(editor).getByRole("button", { name: "Сохранить пункт программы" }),
    );
    await screen.findByRole("region", { name: "Добавить пункт программы" });
    expect(writes[0]).toEqual({
      path: `activities/${first.id}`,
      body: expect.objectContaining({
        title: "Новое название",
        ends_at: first.ends_at + 60000,
        room_id: "second",
      }),
    });
    expect(
      within(
        screen.getByRole("region", { name: "Список пунктов программы" }),
      ).getByRole("heading", { name: "Новое название" }),
    ).toBeVisible();
    expect(screen.getByLabelText("Начало · МСК")).toHaveValue(
      "2026-11-12T10:31",
    );
  });

  it("отменяет редактирование, оставляя добавление открытым", async () => {
    server();
    const user = userEvent.setup();
    render(<TFlow user={host} />);
    await user.click(
      await screen.findByRole("button", {
        name: "Изменить пункт программы Лекция",
      }),
    );
    await user.click(
      screen.getByRole("button", { name: "Отменить редактирование" }),
    );
    expect(
      screen.getByRole("region", { name: "Добавить пункт программы" }),
    ).toBeVisible();
    expect(screen.getByLabelText("Название пункта программы")).toHaveValue("");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
