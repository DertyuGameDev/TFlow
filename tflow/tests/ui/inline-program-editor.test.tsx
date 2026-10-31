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
          activities = activities.map((item) => ({
            ...item,
            ...body,
            updated_at: item.updated_at + 1,
          }));
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

describe("форма над графиком программы", () => {
  it("открывает создание над графиком без модального окна и сохраняет пункт", async () => {
    const writes = server(),
      user = userEvent.setup();
    render(<TFlow user={host} />);
    await user.click(
      await screen.findByRole("button", { name: "Добавить пункт программы" }),
    );
    const editor = screen.getByRole("region", { name: "Пункт программы" });
    const chart = screen.getByRole("region", {
      name: "Графическое расписание",
    });
    expect(
      editor.compareDocumentPosition(chart) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const title = within(editor).getByLabelText("Название пункта программы");
    expect(title).toHaveFocus();
    await user.type(title, "Новая лекция");
    await user.click(
      within(editor).getByRole("button", { name: "Добавить в программу" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("region", { name: "Пункт программы" }),
      ).not.toBeInTheDocument(),
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

  it("синхронизирует минутное изменение на графике с формой и сохраняет незавершённое заполнение", async () => {
    const writes = server(),
      user = userEvent.setup();
    render(<TFlow user={host} />);
    await user.click(
      await screen.findByRole("button", {
        name: "Изменить пункт программы Лекция",
      }),
    );
    const editor = screen.getByRole("region", { name: "Пункт программы" });
    const title = within(editor).getByLabelText("Название пункта программы");
    await user.clear(title);
    await user.type(title, "Новое название");
    fireEvent.keyDown(
      screen.getByRole("button", { name: "Изменить окончание Лекция" }),
      { key: "ArrowRight" },
    );
    await waitFor(() =>
      expect(within(editor).getByLabelText("Окончание · МСК")).toHaveValue(
        "2026-11-12T10:31",
      ),
    );
    expect(title).toHaveValue("Новое название");
    expect(writes[0].body.ends_at).toBe(first.ends_at + 60000);
    await user.selectOptions(
      within(editor).getByLabelText("Аудитория"),
      "second",
    );
    await act(async () => fireEvent.focus(window));
    expect(within(editor).getByLabelText("Аудитория")).toHaveValue("second");
    expect(title).toHaveValue("Новое название");
    await user.click(
      within(editor).getByRole("button", {
        name: "Закрыть форму пункта программы",
      }),
    );
    expect(
      screen.queryByRole("region", { name: "Пункт программы" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
