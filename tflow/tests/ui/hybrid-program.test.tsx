import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { TFlow } from "../../app/tflow";
import type { Activity, Room, UserIdentity } from "../../lib/types";
import { event, profile } from "../fixtures";

const host: UserIdentity = { userId: event.owner_id, displayName: "Организатор", email: "host@example.test", fullName: "Организатор", role: "organizer" };
afterEach(() => history.replaceState({}, "", "/"));

it("созданный в гибридной программе онлайн-флоу появляется в выборе студии рядом с очной программой", async () => {
  const current = { ...event, format: "Гибрид" };
  const rooms: Room[] = [{ id: "hall", event_id: event.id, name: "Главный зал", capacity: 100, is_online: false }];
  const physical: Activity = { id: "physical", event_id: event.id, room_id: "hall", room_name: "Главный зал", title: "Очная лекция", description: "", speaker: "", starts_at: event.starts_at, ends_at: event.starts_at + 30 * 60000, capacity: 30, taken: 0, registered: 0, waitlisted: 0, waiting_count: 0, waitlist_position: 0, updated_at: 1, room_is_online: false };
  const activities = [physical];
  history.replaceState({}, "", `/#manage/${event.id}/program`);
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
    if (url === `/api/events/${event.id}/activities` && init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      expect(body).toMatchObject({ room_id: "", online_room: true, new_room_name: "Онлайн-поток 1" });
      rooms.push({ id: "video", event_id: event.id, name: body.new_room_name, capacity: body.new_room_capacity, is_online: true });
      activities.push({ ...physical, ...body, id: "flow-online", room_id: "video", room_name: body.new_room_name, room_is_online: true });
      return json({ id: "flow-online" }, 201);
    }
    if (url === `/api/events/${event.id}`) return json({ event: current, rooms, activities });
    if (url === `/api/events/${event.id}/attendance`) return json([]);
    if (url === "/api/bootstrap") return json({ events: [current], tickets: [], schedule: [], waitlist: [], communities: [], notifications: [], unread_notification_count: 0, profile: { ...profile, id: host.userId, role: host.role } });
    throw new Error(`Unexpected request: ${url}`);
  }));
  render(<TFlow user={host}/>);
  await userEvent.setup().click(await screen.findByRole("button", { name: "Добавить пункт" }));
  const user = userEvent.setup();
  const editor = screen.getByRole("form", { name: "Пункт на графике" });
  await user.type(within(editor).getByRole("textbox", { name: "Название пункта на графике" }), "Вебинар по Django");
  await user.selectOptions(within(editor).getByRole("combobox", { name: "Аудитория пункта на графике" }),
    within(editor).getByRole("option", { name: "Создать онлайн-поток" }));
  await user.click(within(editor).getByRole("button", { name: "Сохранить пункт на графике" }));
  await waitFor(() => expect(screen.queryByRole("form", { name: "Пункт на графике" })).not.toBeInTheDocument());
  const list = screen.getByRole("region", { name: "Список пунктов программы" });
  expect(within(list).getByRole("heading", { name: "Очная лекция" })).toBeVisible();
  expect(within(list).getByRole("heading", { name: "Вебинар по Django" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Открыть студию" }));
  const studios = await screen.findByRole("region", { name: "Онлайн-флоу мероприятия" });
  expect(within(studios).getByRole("heading", { name: "Вебинар по Django" })).toBeVisible();
  expect(within(studios).queryByRole("heading", { name: "Очная лекция" })).not.toBeInTheDocument();
  expect(within(studios).getByRole("link", { name: "Открыть студию флоу" })).toHaveAttribute("href", `#webinar/${event.id}/flow-online`);
});
