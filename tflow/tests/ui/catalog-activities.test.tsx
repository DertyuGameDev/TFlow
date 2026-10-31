import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TFlow } from "../../app/tflow";
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

describe("карточки каталога без дублирования программы", () => {
  it.each([
    ["участник", participant],
    ["организатор", { ...participant, role: "organizer", userId: event.owner_id }],
    ["гость", null],
  ] as const)("не показывает расписание в каталоге для роли: %s", async (_label, user) => {
    const fetch = mountCatalog(user);
    const title = await screen.findByRole("heading", { name: event.title });
    const card = title.closest("article")!;
    expect(within(card).queryByRole("region", { name: "Расписание активностей" })).not.toBeInTheDocument();
    expect(within(card).queryByText(lecture.title)).not.toBeInTheDocument();
    expect(screen.queryByText("Другая активность")).not.toBeInTheDocument();
    expect(fetch.mock.calls.map(([path]) => path)).toEqual(["/api/bootstrap"]);
  });

  it("сохраняет доступ к флоу через страницу мероприятия", async () => {
    mountCatalog();
    const title = await screen.findByRole("heading", { name: event.title });
    await userEvent.setup().click(within(title).getByRole("button", { name: event.title }));
    const programTab = await screen.findByRole("tab", { name: /Программа/ });
    await userEvent.setup().click(programTab);
    const program = await screen.findByRole("region", { name: /Флоу/ });
    expect(within(program).getByRole("heading", { name: lecture.title })).toBeVisible();
  });
});
