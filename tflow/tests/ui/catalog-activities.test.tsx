import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TFlow } from "../../app/tflow";
import { CatalogActivities } from "../../app/ui/catalog-activities";
import type { Activity, UserIdentity } from "../../lib/types";
import { event, profile } from "../fixtures";

const participant: UserIdentity = {
  userId: profile.id, displayName: profile.name, fullName: profile.name,
  email: profile.email, role: "participant",
};
const lecture: Activity = {
  id: "catalog-lecture", event_id: event.id, room_id: "hall", room_name: "Большой зал",
  title: "Введение в Python", description: "Первая программа", speaker: "Анна Иванова",
  starts_at: event.starts_at, ends_at: event.starts_at + 1800000,
  capacity: 20, taken: 5, registered: 0, waitlisted: 0, waiting_count: 0, waitlist_position: 0, updated_at: 1,
};

afterEach(() => history.replaceState({}, "", "/"));

function mountCatalog(user: UserIdentity | null = participant) {
  history.replaceState({}, "", "/#events");
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  const otherEvent = { ...event, id: "other-event", title: "Другое мероприятие" };
  const activities = [lecture, { ...lecture, id: "other-activity", event_id: otherEvent.id, title: "Другая активность" }];
  const fetch = vi.fn(async (path: string) => {
    const payload = path === "/api/bootstrap" ? {
      events: [event, otherEvent], activities, tickets: [], schedule: [], waitlist: [],
      communities: [], notifications: [], unread_notification_count: 0, profile,
    } : path === `/api/events/${event.id}` ? { event, rooms: [], activities: [lecture] } : undefined;
    if (payload === undefined) throw new Error(`Unexpected request: ${path}`);
    return new Response(JSON.stringify(payload));
  });
  vi.stubGlobal("fetch", fetch);
  render(<TFlow user={user} />);
  return fetch;
}

describe("расписание активностей в карточке мероприятия", () => {
  it("показывает участнику программу своего мероприятия без дополнительного запроса", async () => {
    const fetch = mountCatalog();
    const title = await screen.findByRole("heading", { name: event.title });
    const card = title.closest("article")!;
    const schedule = within(card).getByRole("region", { name: "Расписание активностей" });
    expect(within(schedule).getByRole("link", { name: lecture.title })).toHaveAttribute("href", `#event/${event.id}`);
    expect(within(schedule).getByText(/10:00–10:30 · МСК/)).toBeVisible();
    expect(within(schedule).getByText(lecture.room_name)).toBeVisible();
    expect(within(schedule).getByText(lecture.speaker)).toBeVisible();
    expect(within(schedule).queryByText("Другая активность")).not.toBeInTheDocument();
    expect(fetch.mock.calls.map(([path]) => path)).toEqual(["/api/bootstrap"]);
    await userEvent.setup().click(within(schedule).getByRole("link", { name: lecture.title }));
    const program = await screen.findByRole("region", { name: /Флоу/ });
    expect(within(program).getByRole("heading", { name: lecture.title })).toBeVisible();
    expect(fetch.mock.calls.some(([path]) => path.endsWith("/attendance"))).toBe(false);
  });

  it.each([
    ["организатор", { ...participant, role: "organizer", userId: event.owner_id }],
    ["гость", null],
  ] as const)("не добавляет новый блок в карточки для роли: %s", async (_label, user) => {
    mountCatalog(user);
    await screen.findByRole("heading", { name: event.title });
    expect(screen.queryByRole("region", { name: "Расписание активностей" })).not.toBeInTheDocument();
  });

  it("сортирует по времени, разворачивает длинную программу и сохраняет статусы участника", async () => {
    const activities = Array.from({ length: 4 }, (_, index) => ({
      ...lecture, id: `activity-${index}`, title: `Активность ${index + 1}`,
      starts_at: lecture.starts_at + index * 1800000,
      ends_at: lecture.ends_at + index * 1800000,
      registered: Number(index === 0), waitlisted: Number(index === 1), waitlist_position: index === 1 ? 2 : 0,
      room_is_online: index === 2,
    })).reverse();
    const originalOrder = activities.map((item) => item.id);
    render(<CatalogActivities activities={activities} />);
    expect(screen.getAllByRole("link").map((link) => link.textContent))
      .toEqual(["Активность 1", "Активность 2", "Активность 3"]);
    expect(screen.getByText("Вы записаны")).toBeVisible();
    expect(screen.getByText("Вы в очереди · № 2")).toBeVisible();
    expect(screen.getByText(`Онлайн · ${lecture.room_name}`)).toBeVisible();
    const person = userEvent.setup();
    const expand = screen.getByRole("button", { name: "Все активности (4)" });
    expect(expand).toHaveAttribute("aria-expanded", "false");
    await person.click(expand);
    expect(screen.getByRole("link", { name: "Активность 4" })).toBeVisible();
    expect(expand).toHaveAttribute("aria-expanded", "true");
    await person.click(screen.getByRole("button", { name: "Свернуть активности" }));
    expect(screen.queryByRole("link", { name: "Активность 4" })).not.toBeInTheDocument();
    expect(activities.map((item) => item.id)).toEqual(originalOrder);
  });

  it("не показывает пустое расписание", () => {
    render(<CatalogActivities activities={[]} />);
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });
});
