import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventRegistrationAction, EventWaitlists } from "../../app/ui/event-waitlist";
import { TFlow } from "../../app/tflow";
import { event, profile, notice } from "../fixtures";

const full = { ...event, capacity: 1, participant_count: 1 };
const queued = { ...full, event_waitlisted: 1, event_waiting_count: 2, event_waitlist_position: 2 };
const user = { userId: profile.id, displayName: profile.name, fullName: profile.name, email: profile.email, role: profile.role };
afterEach(() => history.replaceState({}, "", "/"));

describe("лист ожидания мероприятия", () => {
  it("предлагает очередь вместо заблокированной регистрации на полное событие", async () => {
    const join = vi.fn(), register = vi.fn();
    render(<EventRegistrationAction event={full} profile={profile} pending={false} onRegister={register} onJoin={join} onLeave={vi.fn()} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Встать в лист ожидания" }));
    expect(join).toHaveBeenCalledOnce();
    expect(register).not.toHaveBeenCalled();
  });

  it("показывает позицию, выход и возможность дополнить анкету без потери очереди", async () => {
    const join = vi.fn(), leave = vi.fn(), person = userEvent.setup();
    render(<EventRegistrationAction event={{ ...queued, required_profile_fields: ["phone"] }} profile={profile} pending={false} onRegister={vi.fn()} onJoin={join} onLeave={leave} />);
    expect(screen.getByRole("status")).toHaveTextContent("Место в очереди: 2");
    await person.click(screen.getByRole("button", { name: "Дополнить данные" }));
    await person.click(screen.getByRole("button", { name: "Выйти из листа ожидания" }));
    expect(join).toHaveBeenCalledOnce();
    expect(leave).toHaveBeenCalledOnce();
  });

  it("не предлагает новую запись на завершившееся событие, но позволяет покинуть старую очередь", () => {
    const props = { profile, pending: false, onRegister: vi.fn(), onJoin: vi.fn(), onLeave: vi.fn() };
    const view = render(<EventRegistrationAction {...props} event={{ ...full, ends_at: Date.now() - 1 }} />);
    expect(screen.getByRole("button", { name: "Событие завершено" })).toBeDisabled();
    view.rerender(<EventRegistrationAction {...props} event={{ ...queued, ends_at: Date.now() - 1 }} />);
    expect(screen.getByRole("button", { name: "Выйти из листа ожидания" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Дополнить данные" })).not.toBeInTheDocument();
  });

  it("в списке личных очередей остаются только ожидающие события", async () => {
    const leave = vi.fn();
    render(<EventWaitlists events={[queued, { ...event, id: "ticket", title: "Уже записан", enrolled: 1, event_waitlisted: 1 }]} pending={false} onLeave={leave} />);
    expect(screen.getByRole("link", { name: event.title })).toHaveAttribute("href", `#event/${event.id}`);
    expect(screen.queryByText("Уже записан")).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: `Выйти из листа ожидания: ${event.title}` }));
    expect(leave).toHaveBeenCalledWith(queued);
  });
});

function app({ needsProfile = false, immediate = false, initialQueue = false, route = `event/${event.id}` } = {}) {
  let waiting = initialQueue, registered = false, phone = "";
  history.replaceState({}, "", `/#${route}`);
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  const fetch = vi.fn(async (path: string, init?: RequestInit) => {
    const current = { ...full, enrolled: Number(registered), event_waitlisted: Number(waiting), event_waiting_count: Number(waiting), event_waitlist_position: waiting ? 1 : 0, required_profile_fields: needsProfile ? ["phone"] : [] };
    if (path === `/api/events/${event.id}/waitlist`) {
      if (init?.method === "DELETE") { waiting = false; return response({ ok: true, registered }); }
      const fields = JSON.parse(init?.body as string);
      if (needsProfile && !fields.phone) return response({ code: "PROFILE_INCOMPLETE", error: "Дополните данные", missing_fields: ["phone"] }, 409);
      phone = fields.phone ?? phone;
      waiting = !immediate;
      registered = immediate;
      return response({ ok: true, waitlisted: waiting, registered });
    }
    if (path === "/api/bootstrap") return response({
      events: [current], tickets: registered ? [current] : [], schedule: [], waitlist: [], communities: [],
      notifications: registered ? [notice("promoted", { kind: "event_waitlist" })] : [], unread_notification_count: registered ? 1 : 0,
      profile: { ...profile, phone },
    });
    if (path === `/api/events/${event.id}`) return response({ event: current, rooms: [], activities: [] });
    throw new Error(`Unexpected request: ${path}`);
  });
  vi.stubGlobal("fetch", fetch);
  render(<TFlow user={user} />);
  return { fetch, promote: () => { waiting = false; registered = true; } };
}

describe("очередь мероприятия в приложении", () => {
  it("вступает, показывает позицию и позволяет выйти через API", async () => {
    const person = userEvent.setup(), { fetch } = app();
    await person.click(await screen.findByRole("button", { name: "Встать в лист ожидания" }));
    expect(await screen.findByRole("status", { name: "Вы в листе ожидания мероприятия" })).toHaveTextContent("Место в очереди: 1");
    expect(fetch).toHaveBeenCalledWith(`/api/events/${event.id}/waitlist`, expect.objectContaining({ method: "POST" }));
    await person.click(screen.getByRole("button", { name: "Выйти из листа ожидания" }));
    expect(await screen.findByRole("button", { name: "Встать в лист ожидания" })).toBeEnabled();
    expect(fetch).toHaveBeenCalledWith(`/api/events/${event.id}/waitlist`, expect.objectContaining({ method: "DELETE" }));
  });

  it("дополняет обязательные поля через ту же форму и сохраняет результат очереди", async () => {
    const person = userEvent.setup(), { fetch } = app({ needsProfile: true });
    await person.click(await screen.findByRole("button", { name: "Встать в лист ожидания" }));
    const dialog = await screen.findByRole("dialog");
    await person.type(within(dialog).getByLabelText(/Телефон/), "123");
    await person.click(within(dialog).getByRole("button", { name: "Сохранить и встать в очередь" }));
    expect(await screen.findByRole("status", { name: "Вы в листе ожидания мероприятия" })).toBeVisible();
    expect(fetch).toHaveBeenCalledWith(`/api/events/${event.id}/waitlist`, expect.objectContaining({ body: JSON.stringify({ phone: "123" }) }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("сообщает о полученной регистрации, если место освободилось во время запроса", async () => {
    app({ immediate: true });
    await userEvent.setup().click(await screen.findByRole("button", { name: "Встать в лист ожидания" }));
    expect(await screen.findByText("Место доступно! Вы зарегистрированы на мероприятие. Оно добавлено в календарь.")).toBeVisible();
    expect(await screen.findByRole("button", { name: "Показать мой QR" })).toBeVisible();
    expect(screen.queryByRole("status", { name: "Вы в листе ожидания мероприятия" })).not.toBeInTheDocument();
  });

  it("после автоматической регистрации удаляет очередь из профиля и обновляет уведомления", async () => {
    const next = app({ initialQueue: true, route: "profile" });
    expect(await screen.findByRole("region", { name: "Лист ожидания мероприятий" })).toBeVisible();
    next.promote();
    await act(async () => fireEvent.focus(window));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Лист ожидания мероприятий" })).not.toBeInTheDocument());
    expect(screen.getByRole("link", { name: "Уведомления: 1 непрочитанных" })).toBeVisible();
    expect(screen.getByText(`Место освободилось! Вы зарегистрированы на мероприятие «${event.title}».`)).toBeVisible();
  });

  it("сохраняет полученный билет при выходе через устаревший экран очереди", async () => {
    const next = app({ initialQueue: true });
    const leave = await screen.findByRole("button", { name: "Выйти из листа ожидания" });
    next.promote();
    await userEvent.setup().click(leave);
    expect(await screen.findByText("Вы уже получили место на мероприятии. Регистрация сохранена в календаре.")).toBeVisible();
    expect(await screen.findByRole("button", { name: "Показать мой QR" })).toBeVisible();
  });
});
