import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TFlow } from "../../app/tflow";
import type { Activity, UserIdentity } from "../../lib/types";
import { event, profile } from "../fixtures";

const participant: UserIdentity = {
  userId: profile.id, displayName: profile.name, fullName: profile.name,
  email: profile.email, role: "participant",
};
const owner: UserIdentity = { ...participant, userId: event.owner_id, role: "organizer" };
const lecture: Activity = {
  id: "flow-one", event_id: event.id, room_id: "room-one", room_name: "Большой зал",
  title: "Знакомство с Python", description: "Первая программа вместе с преподавателем",
  speaker: "Анна Иванова", starts_at: event.starts_at, ends_at: event.starts_at + 3600000,
  capacity: 20, taken: 5, registered: 0, waitlisted: 0, waiting_count: 0, waitlist_position: 0, updated_at: 1,
};
const workshop: Activity = {
  ...lecture, id: "flow-two", room_id: "room-two", room_name: "Мастерская",
  title: "Практика Django", description: "Создаём своё приложение", speaker: "Иван Петров",
  starts_at: lecture.ends_at, ends_at: event.ends_at,
};

function mount(user: UserIdentity | null = participant, initial: Activity[] = [workshop, lecture]) {
  let activities = initial.map((item) => ({ ...item }));
  let enrolled = false;
  history.replaceState({}, "", `/#event/${event.id}`);
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  const fetch = vi.fn(async (path: string, init?: RequestInit) => {
    const currentEvent = { ...event, enrolled: Number(enrolled), activity_count: activities.length };
    const match = path.match(/^\/api\/activities\/([^/]+)\/(registration|waitlist)$/);
    if (match) {
      const item = activities.find((activity) => activity.id === match[1])!;
      if (match[2] === "registration") {
        item.registered = Number(init?.method === "POST");
        item.taken += init?.method === "POST" ? 1 : -1;
      } else {
        item.waitlisted = Number(init?.method === "POST");
        item.waitlist_position = item.waitlisted;
      }
      enrolled = true;
      return new Response(JSON.stringify({ ok: true }));
    }
    const payload = path === "/api/bootstrap" ? {
      events: [currentEvent], tickets: enrolled ? [currentEvent] : [],
      schedule: activities.filter((item) => item.registered), waitlist: activities.filter((item) => item.waitlisted),
      communities: [], notifications: [], unread_notification_count: 0,
      profile: user ? { ...profile, id: user.userId, role: user.role } : null,
    } : path === `/api/events/${event.id}` ? { event: currentEvent, rooms: [], activities }
      : undefined;
    if (payload === undefined) throw new Error(`Unexpected request: ${path}`);
    return new Response(JSON.stringify(payload));
  });
  vi.stubGlobal("fetch", fetch);
  render(<TFlow user={user} />);
  return fetch;
}

afterEach(() => history.replaceState({}, "", "/"));

describe("флоу на странице мероприятия", () => {
  it.each([
    ["гость", null], ["участник", participant], ["владелец", owner],
    ["другой организатор", { ...owner, userId: "other-host" }],
  ] as const)("видит активности вместо блока участников: %s", async (_label, user) => {
    const fetch = mount(user);
    const section = await screen.findByRole("region", { name: /Флоу\s*2/ });
    expect(within(section).getByRole("heading", { name: lecture.title })).toBeVisible();
    const first = within(section).getAllByRole("article")[0];
    expect(within(first).getByText(lecture.speaker)).toBeVisible();
    expect(within(first).getByText(lecture.room_name)).toBeVisible();
    expect(within(first).getByText("10:00")).toBeVisible();
    expect(within(section).getAllByText("15 из 20 мест свободно")).toHaveLength(2);
    expect(screen.queryByRole("region", { name: /Участники/ })).not.toBeInTheDocument();
    expect(fetch.mock.calls.some(([path]) => path.endsWith("/attendance"))).toBe(false);
    if (user?.role === "organizer") expect(within(section).queryByRole("button", { name: "Записаться" })).not.toBeInTheDocument();
  });

  it("сортирует флоу по времени и позволяет найти по спикеру или аудитории", async () => {
    mount();
    const person = userEvent.setup();
    const section = await screen.findByRole("region", { name: /Флоу/ });
    expect(within(section).getAllByRole("article").map((item) => within(item).getByRole("heading").textContent))
      .toEqual([lecture.title, workshop.title]);
    await person.type(within(section).getByRole("textbox", { name: "Найти активность" }), "Иван Петров");
    expect(within(section).queryByRole("heading", { name: lecture.title })).not.toBeInTheDocument();
    expect(within(section).getByRole("heading", { name: workshop.title })).toBeVisible();
    await person.clear(within(section).getByRole("textbox", { name: "Найти активность" }));
    await person.selectOptions(within(section).getByLabelText("Аудитория"), lecture.room_id);
    expect(within(section).getByRole("heading", { name: lecture.title })).toBeVisible();
    expect(within(section).queryByRole("heading", { name: workshop.title })).not.toBeInTheDocument();
  });

  it("записывает участника на флоу через API и позволяет отменить запись", async () => {
    const fetch = mount(participant, [lecture]);
    const person = userEvent.setup();
    await person.click(await screen.findByRole("button", { name: "Записаться" }));
    expect(await screen.findByText("Вы записаны", { exact: true })).toBeVisible();
    expect(fetch).toHaveBeenCalledWith(`/api/activities/${lecture.id}/registration`, expect.objectContaining({ method: "POST" }));
    await person.click(screen.getByRole("button", { name: "Отменить запись" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Записаться" })).toBeEnabled());
    expect(fetch).toHaveBeenCalledWith(`/api/activities/${lecture.id}/registration`, expect.objectContaining({ method: "DELETE" }));
  });

  it("при отсутствии мест предлагает очередь активности", async () => {
    const fetch = mount(participant, [{ ...lecture, taken: lecture.capacity }]);
    await userEvent.setup().click(await screen.findByRole("button", { name: "В лист ожидания" }));
    expect(await screen.findByText("Вы в очереди · № 1")).toBeVisible();
    expect(fetch).toHaveBeenCalledWith(`/api/activities/${lecture.id}/waitlist`, expect.objectContaining({ method: "POST" }));
  });

  it("показывает понятное состояние мероприятия без активностей", async () => {
    mount(null, []);
    const section = await screen.findByRole("region", { name: /Флоу\s*0/ });
    expect(within(section).getByText(/Активности пока не добавлены/)).toBeVisible();
    expect(within(section).queryByRole("textbox")).not.toBeInTheDocument();
  });
});
