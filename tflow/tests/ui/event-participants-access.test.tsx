import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TFlow } from "../../app/tflow";
import type { UserIdentity } from "../../lib/types";
import { event, profile } from "../fixtures";

const owner: UserIdentity = {
  userId: event.owner_id, role: "organizer", displayName: "Организатор",
  email: "host@example.test", fullName: "Организатор",
};

function mount(user: UserIdentity | null) {
  const fetch = vi.fn(async (path: string) => {
    const payload = path === "/api/bootstrap" ? {
      events: [event], tickets: [], schedule: [], waitlist: [], communities: [],
      notifications: [], unread_notification_count: 0,
      profile: user ? { ...profile, id: user.userId, role: user.role } : null,
    } : path === `/api/events/${event.id}` ? { event, rooms: [], activities: [] }
      : path === `/api/events/${event.id}/attendance` ? [{
        id: profile.id, name: profile.name, email: profile.email, city: profile.city,
        profile_data: profile, created_at: event.starts_at, checked_in_at: null,
      }] : undefined;
    if (payload === undefined) throw new Error(`Unexpected request: ${path}`);
    return new Response(JSON.stringify(payload), { status: 200 });
  });
  vi.stubGlobal("fetch", fetch);
  render(<TFlow user={user} />);
  return fetch;
}

beforeEach(() => {
  history.replaceState({}, "", `/#event/${event.id}`);
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});
afterEach(() => history.replaceState({}, "", "/"));

describe("доступ к анкетам из управления событием", () => {
  it("показывает флоу на странице события, а анкеты загружает в кабинете владельца", async () => {
    const user = userEvent.setup(), fetch = mount(owner);
    await user.click(await screen.findByRole("tab", { name: /^Программа/ }));
    await user.click(screen.getByRole("button", { name: "Управлять флоу" }));
    await waitFor(() => expect(screen.getByRole("tab", { name: /^Программа/ })).toHaveAttribute("aria-selected", "true"));
    expect(location.hash).toBe(`#manage/${event.id}/program`);
    await user.click(screen.getByRole("tab", { name: "Событие" }));
    await user.click(screen.getByRole("button", { name: "Открыть профиль: Анна Петрова" }));
    expect(screen.getByRole("dialog", { name: "Анна Петрова" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Закрыть" }));
    await user.click(screen.getByRole("button", { name: "Все участники" }));
    expect(screen.getByRole("tab", { name: "Событие" })).toHaveAttribute("aria-selected", "true");
    expect(document.querySelector("details.management-participants")).toHaveAttribute("open");
    expect(screen.queryByRole("tab", { name: /Участники/ })).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(`/api/events/${event.id}/attendance`, expect.anything());
  });

  it.each([
    ["владельцу на публичной странице", owner],
    ["гостю", null],
    ["участнику", { ...owner, userId: "participant-one", role: "participant" }],
    ["чужому организатору", { ...owner, userId: "other-host" }],
  ] as const)("не показывает анкеты и не запрашивает их %s", async (_label, user) => {
    const fetch = mount(user);
    expect(await screen.findByRole("heading", { name: event.title })).toBeVisible();
    expect(screen.queryByRole("button", { name: /Открыть профиль:/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /Участники/ })).not.toBeInTheDocument();
    expect(fetch.mock.calls.some(([path]) => path.endsWith("/attendance"))).toBe(false);
  });
});
