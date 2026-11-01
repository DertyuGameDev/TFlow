import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TFlow } from "../../app/tflow";
import { event, profile } from "../fixtures";
import type { UserIdentity } from "../../lib/types";

const participant: UserIdentity = { userId: profile.id, displayName: profile.name, fullName: profile.name, email: profile.email, role: "participant" };
function mount(initiallyCheckedIn = false, user = participant, route = "profile") {
  let checkedIn = initiallyCheckedIn;
  history.replaceState({}, "", `/#${route}`);
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  const fetch = vi.fn(async (path: string) => {
    const current = { ...event, enrolled: 1, checked_in: Number(checkedIn), checked_in_count: 5 };
    const payload = path === "/api/bootstrap" ? {
      events: [current], tickets: user.role === "participant" ? [current] : [],
      schedule: [], waitlist: [], communities: [], notifications: [], unread_notification_count: 0,
      profile: { ...profile, id: user.userId, role: user.role },
    } : path === `/api/events/${event.id}` ? { event: current, rooms: [], activities: [] } : undefined;
    if (payload === undefined) throw new Error(`Unexpected request: ${path}`);
    return new Response(JSON.stringify(payload), { status: 200 });
  });
  vi.stubGlobal("fetch", fetch);
  const view = render(<TFlow user={user} />);
  return { ...view, scan: () => { checkedIn = true; }, fetch };
}
afterEach(() => { vi.useRealTimers(); history.replaceState({}, "", "/"); });

describe("подтверждение входа участнику после скана QR", () => {
  it("автоматически показывает статус у QR после новой отметки и не повторяет сообщение", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const view = mount();
    await screen.findByRole("img", { name: "Ваш личный QR-код для входа на мероприятия" });
    expect(screen.queryByRole("status", { name: "Вход в мероприятие подтверждён" })).not.toBeInTheDocument();
    view.scan();
    await act(async () => { vi.advanceTimersByTime(5000); });
    const status = await screen.findByRole("status", { name: "Вход в мероприятие подтверждён" });
    expect(within(status).getByText("Вы вошли в мероприятие")).toBeVisible();
    expect(within(status).getByRole("link", { name: event.title })).toHaveAttribute("href", `#event/${event.id}`);
    expect(screen.getByText(`Вы вошли в мероприятие «${event.title}».`)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Закрыть уведомление" }));
    await act(async () => { vi.advanceTimersByTime(5000); });
    expect(screen.queryByText(`Вы вошли в мероприятие «${event.title}».`)).not.toBeInTheDocument();
    expect(status).toBeVisible();
  });

  it("сохраняет статус при открытии профиля, не повторяя старый всплывающий текст", async () => {
    mount(true);
    expect(await screen.findByRole("status", { name: "Вход в мероприятие подтверждён" })).toBeVisible();
    expect(screen.queryByText(`Вы вошли в мероприятие «${event.title}».`)).not.toBeInTheDocument();
  });

  it("показывает подтверждение на странице события и блокирует отмену после входа", async () => {
    mount(true, participant, `event/${event.id}`);
    expect(await screen.findByRole("status", { name: "Вход в мероприятие подтверждён" })).toHaveTextContent("Вы вошли в мероприятие");
    expect(screen.getByText("Ваш вход подтверждён")).toBeVisible();
    expect(screen.getByRole("button", { name: "Отменить регистрацию" })).toBeDisabled();
  });

  it("не показывает участническое подтверждение в профиле организатора", async () => {
    mount(true, { ...participant, userId: event.owner_id, role: "organizer" });
    await screen.findByRole("heading", { name: "Ваш профиль" });
    await waitFor(() => expect(screen.getByText("Аккаунт организатора")).toBeVisible());
    expect(screen.queryByText("Вы вошли в мероприятие")).not.toBeInTheDocument();
  });

  it("показывает подтверждение в карточке календаря", async () => {
    mount(true, participant, "calendar/2026-11-12/day");
    fireEvent.click(await screen.findByRole("button", { name: `${event.title}, 10:00–12:00` }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("status", { name: "Вход в мероприятие подтверждён" })).toHaveTextContent("Вы вошли в мероприятие");
    expect(within(dialog).queryByRole("button", { name: "Отменить регистрацию" })).not.toBeInTheDocument();
  });
});
