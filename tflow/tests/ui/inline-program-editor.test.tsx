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

function server(initial: Activity[] = [first]) {
  let activities = initial.map((item) => ({ ...item }));
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

async function mountTimeline() {
  render(<TFlow user={host} />);
  await userEvent
    .setup()
    .click(await screen.findByRole("button", { name: "Шкала времени" }));
}

describe("редактирование прямо на графике", () => {
  it("показывает аудитории над графиком, не создаёт отдельную форму и добавляет пункт по Enter", async () => {
    const writes = server(),
      user = userEvent.setup();
    await mountTimeline();
    const graph = await screen.findByRole("region", {
      name: "Графическое расписание",
    });
    const rooms = screen.getByRole("heading", { name: "Аудитории", level: 2 });
    expect(
      rooms.compareDocumentPosition(graph) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      screen.queryByLabelText("Название пункта программы"),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Начало · МСК")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Добавить пункт" }));
    const editor = within(graph).getByRole("form", {
      name: "Пункт на графике",
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const title = within(editor).getByRole("textbox", {
      name: "Название пункта на графике",
    });
    expect(title).toHaveFocus();
    await user.type(title, "Новая лекция");
    fireEvent.change(
      within(editor).getByLabelText("Начало пункта на графике"),
      { target: { value: "10:37" } },
    );
    fireEvent.change(
      within(editor).getByLabelText("Окончание пункта на графике"),
      { target: { value: "10:49" } },
    );
    expect(title).toHaveValue("Новая лекция");
    await user.click(title);
    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(
        screen.queryByRole("form", { name: "Пункт на графике" }),
      ).not.toBeInTheDocument(),
    );
    expect(writes[0]).toEqual({
      path: `events/${event.id}/activities`,
      body: expect.objectContaining({
        title: "Новая лекция",
        starts_at: event.starts_at + 37 * 60000,
        ends_at: event.starts_at + 49 * 60000,
      }),
    });
    expect(
      within(
        screen.getByRole("region", { name: "Список пунктов программы" }),
      ).getByRole("heading", { name: "Новая лекция" }),
    ).toBeVisible();
  });

  it("открывает существующий пункт на графике и сохраняет название и минутное время вместе", async () => {
    const writes = server(),
      user = userEvent.setup();
    await mountTimeline();
    await user.click(
      await screen.findByRole("button", { name: "Лекция · 10:00–10:30" }),
    );
    const editor = screen.getByRole("form", { name: "Пункт на графике" });
    const title = within(editor).getByRole("textbox", {
      name: "Название пункта на графике",
    });
    await user.clear(title);
    await user.type(title, "Новое название");
    fireEvent.change(
      within(editor).getByLabelText("Окончание пункта на графике"),
      { target: { value: "10:31" } },
    );
    await user.selectOptions(
      within(editor).getByLabelText("Аудитория пункта на графике"),
      "second",
    );
    await act(async () => fireEvent.focus(window));
    expect(title).toHaveValue("Новое название");
    await user.click(
      within(editor).getByRole("button", {
        name: "Сохранить пункт на графике",
      }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("form", { name: "Пункт на графике" }),
      ).not.toBeInTheDocument(),
    );
    expect(writes[0]).toEqual({
      path: `activities/${first.id}`,
      body: expect.objectContaining({
        title: "Новое название",
        ends_at: first.ends_at + 60000,
        room_id: "second",
        expected_updated_at: first.updated_at,
      }),
    });
    expect(
      screen.queryByLabelText("Название пункта программы"),
    ).not.toBeInTheDocument();
  });

  it("сохраняет перенос целого пункта вместе с названием после подтверждения", async () => {
    const writes = server(),
      user = userEvent.setup();
    await mountTimeline();
    await user.click(
      await screen.findByRole("button", { name: "Лекция · 10:00–10:30" }),
    );
    const editor = screen.getByRole("form", { name: "Пункт на графике" });
    const title = within(editor).getByRole("textbox", {
      name: "Название пункта на графике",
    });
    await user.clear(title);
    await user.type(title, "Передвинутая лекция");
    screen.getByRole("button", { name: "Переместить Лекция" }).focus();
    await user.keyboard("{Alt>}{ArrowRight}{/Alt}");
    await waitFor(() =>
      expect(
        within(editor).getByLabelText("Начало пункта на графике"),
      ).toHaveValue("10:01"),
    );
    expect(
      within(editor).getByLabelText("Окончание пункта на графике"),
    ).toHaveValue("10:31");
    expect(title).toHaveValue("Передвинутая лекция");
    expect(writes).toEqual([]);
    await user.click(title);
    await user.keyboard("{Enter}");
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].body).toMatchObject({
      title: "Передвинутая лекция",
      starts_at: first.starts_at + 60000,
      ends_at: first.ends_at + 60000,
      expected_updated_at: first.updated_at,
    });
  });

  it("отменяет новую запись без запроса к серверу", async () => {
    const writes = server(),
      user = userEvent.setup();
    await mountTimeline();
    await user.click(
      await screen.findByRole("button", { name: "Добавить пункт" }),
    );
    const editor = screen.getByRole("form", { name: "Пункт на графике" });
    await user.type(
      within(editor).getByRole("textbox", {
        name: "Название пункта на графике",
      }),
      "Не сохранять",
    );
    await user.keyboard("{Escape}");
    expect(
      screen.queryByRole("form", { name: "Пункт на графике" }),
    ).not.toBeInTheDocument();
    expect(writes).toEqual([]);
  });

  it("дополнительные параметры не дублируют название и время", async () => {
    server();
    const user = userEvent.setup();
    await mountTimeline();
    await user.click(
      await screen.findByRole("button", { name: "Лекция · 10:00–10:30" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Другие параметры пункта" }),
    );
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).queryByLabelText("Название пункта программы"),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).queryByLabelText("Начало · МСК"),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).queryByLabelText("Окончание · МСК"),
    ).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText("Лимит мест")).toBeVisible();
    expect(
      within(dialog).getByLabelText("Спикер · необязательно"),
    ).toBeVisible();
  });
});

describe("вертикальный флоу организатора", () => {
  it("редактирует внутри блока и не теряет название при изменении порядка пунктов", async () => {
    const writes = server([
      first,
      {
        ...first,
        id: "other",
        title: "Другой пункт",
        starts_at: first.starts_at + 15 * 60000,
        ends_at: first.ends_at + 15 * 60000,
        room_id: "second",
      },
    ]);
    const user = userEvent.setup();
    render(<TFlow user={host} />);
    const flow = await screen.findByRole("region", {
      name: "Флоу организатора",
    });
    expect(
      within(flow).getByRole("list", { name: "Флоу мероприятия" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("region", { name: "Графическое расписание" }),
    ).not.toBeInTheDocument();
    await user.click(
      within(flow).getByRole("button", {
        name: "Изменить пункт программы Лекция",
      }),
    );
    const editor = within(flow).getByRole("form", { name: "Пункт на графике" });
    const title = within(editor).getByRole("textbox", {
      name: "Название пункта на графике",
    });
    await user.clear(title);
    await user.type(title, "Название остаётся");
    fireEvent.change(
      within(editor).getByLabelText("Начало пункта на графике"),
      { target: { value: "10:50" } },
    );
    fireEvent.change(
      within(editor).getByLabelText("Окончание пункта на графике"),
      { target: { value: "11:10" } },
    );
    expect(title).toHaveValue("Название остаётся");
    expect(within(flow).getByRole("form", { name: "Пункт на графике" })).toBe(
      editor,
    );
    await user.click(title);
    await user.keyboard("{Enter}");
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].body).toMatchObject({
      title: "Название остаётся",
      starts_at: first.starts_at + 50 * 60000,
      ends_at: first.starts_at + 70 * 60000,
    });
    expect(
      await within(flow).findByRole("heading", { name: "Название остаётся" }),
    ).toBeVisible();
    await user.click(
      within(flow).getByRole("button", { name: /^Название остаётся/ }),
    );
    expect(
      within(flow).getByRole("button", {
        name: "Поменять местами Название остаётся",
      }),
    ).toBeVisible();
  });
});
