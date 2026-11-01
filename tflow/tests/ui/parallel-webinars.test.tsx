import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TFlow } from "../../app/tflow";
import type { Activity, UserIdentity } from "../../lib/types";
import { event, profile } from "../fixtures";

vi.mock("../../app/ui/webinar", () => ({ default: ({ activity }: { activity?: Activity }) =>
  <section aria-label="Открытый эфир">{activity?.id ?? "general"}</section> }));
const participant: UserIdentity = { userId: profile.id, displayName: profile.name, fullName: profile.name, email: profile.email, role: "participant" };
const owner: UserIdentity = { ...participant, userId: event.owner_id, role: "organizer" };
const first: Activity = { id: "python", event_id: event.id, room_id: "online-a", room_name: "Python",
  title: "Флоу Python", description: "", speaker: "Анна", starts_at: event.starts_at, ends_at: event.ends_at,
  capacity: 20, taken: 1, registered: 1, waitlisted: 0, waiting_count: 0, waitlist_position: 0, updated_at: 1, room_is_online: true };
const second = { ...first, id: "django", room_id: "online-b", room_name: "Django", title: "Флоу Django", registered: 0 };

function mount(user = participant, mode = "", options: { activities?: Activity[]; enrolled?: number; format?: string } = {}) {
  const activities = (options.activities ?? [first, second]).map((a) => ({ ...a, registered: user.role === "participant" ? a.registered : 0 }));
  const current = { ...event, format: options.format ?? "Гибрид", enrolled: options.enrolled ?? Number(user.role === "participant") };
  history.replaceState({}, "", `/#webinar/${event.id}${mode ? `/${mode}` : ""}`);
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  const fetch = vi.fn(async (path: string) => {
    const payload = path === "/api/bootstrap" ? {
      events: [current], tickets: current.enrolled ? [current] : [], schedule: activities.filter((a) => a.registered),
      waitlist: [], communities: [], notifications: [], unread_notification_count: 0,
      profile: { ...profile, id: user.userId, role: user.role },
    } : path === `/api/events/${event.id}` ? { event: current, rooms: [], activities } : undefined;
    if (!payload) throw new Error(`Unexpected request: ${path}`);
    return new Response(JSON.stringify(payload));
  });
  vi.stubGlobal("fetch", fetch);
  render(<TFlow user={user} />);
  return fetch;
}
afterEach(() => history.replaceState({}, "", "/"));

describe("выбор параллельных онлайн-флоу", () => {
  it("показывает организатору две отдельные студии с разными ссылками в новых вкладках", async () => {
    mount(owner);
    const section = await screen.findByRole("region", { name: "Онлайн-флоу мероприятия" });
    const links = within(section).getAllByRole("link", { name: "Открыть студию флоу" });
    expect(new Set(links.map((link) => link.getAttribute("href")))).toEqual(new Set([`#webinar/${event.id}/python`, `#webinar/${event.id}/django`]));
    for (const link of links) expect(link).toHaveAttribute("target", "_blank");
    expect(screen.queryByRole("region", { name: "Открытый эфир" })).not.toBeInTheDocument();
  });

  it("участник открывает только зарегистрированный флоу, второй показывает конфликт времени", async () => {
    mount();
    const section = await screen.findByRole("region", { name: "Онлайн-флоу мероприятия" });
    const link = within(section).getByRole("link", { name: "Войти в вебинар флоу" });
    expect(link).toHaveAttribute("href", `#webinar/${event.id}/python`);
    expect(within(section).getByRole("button", { name: "Время занято" })).toBeDisabled();
    await userEvent.setup().click(link);
    await waitFor(() => expect(screen.getByRole("region", { name: "Открытый эфир" })).toHaveTextContent("python"));
  });

  it("прямая ссылка на второй поток передаёт именно его в компонент вебинара", async () => {
    mount(owner, "django");
    expect(await screen.findByRole("region", { name: "Открытый эфир" })).toHaveTextContent("django");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Флоу Django");
  });

  it("прямая ссылка не пускает участника в чужой флоу по одному билету события", async () => {
    mount(participant, "django");
    expect(await screen.findByRole("heading", { name: "Запишитесь на этот флоу" })).toBeVisible();
    expect(screen.queryByRole("region", { name: "Открытый эфир" })).not.toBeInTheDocument();
  });

  it("неизвестный флоу не подменяется общим эфиром", async () => {
    mount(owner, "missing");
    expect(await screen.findByRole("heading", { name: "Флоу не найден" })).toBeVisible();
    expect(screen.queryByRole("region", { name: "Открытый эфир" })).not.toBeInTheDocument();
  });

  it("сохраняет явный доступ к общему эфиру мероприятия", async () => {
    mount(owner, "general");
    expect(await screen.findByRole("region", { name: "Открытый эфир" })).toHaveTextContent("general");
  });
});


describe("вход в открытый вебинар гибридного события", () => {
  const open = { ...first, registered: 0, registration_required: false, event_enrolled: true };

  it.each(["Гибрид", "Онлайн"])("ссылка на флоу без отдельной записи открывает эфир: %s", async (format) => {
    mount(participant, "", { activities: [open], format });
    const section = await screen.findByRole("region", { name: "Онлайн-флоу мероприятия" });
    await userEvent.setup().click(within(section).getByRole("link", { name: "Войти в вебинар флоу" }));
    expect(await screen.findByRole("region", { name: "Открытый эфир" })).toHaveTextContent(open.id);
    expect(screen.queryByRole("heading", { name: "Запишитесь на этот флоу" })).not.toBeInTheDocument();
  });

  it("прямая ссылка пускает с билетом без добавления флоу в расписание", async () => {
    mount(participant, open.id, { activities: [open] });
    expect(await screen.findByRole("region", { name: "Открытый эфир" })).toHaveTextContent(open.id);
  });

  it("открытый флоу по-прежнему требует билет мероприятия", async () => {
    mount(participant, open.id, { activities: [{ ...open, event_enrolled: false }], enrolled: 0 });
    expect(await screen.findByRole("heading", { name: "Сначала зарегистрируйтесь" })).toBeVisible();
    expect(screen.queryByRole("region", { name: "Открытый эфир" })).not.toBeInTheDocument();
  });

  it("гибридное событие с очной программой сохраняет общий онлайн-эфир", async () => {
    mount(participant, "", { activities: [{ ...first, room_is_online: false }] });
    expect(await screen.findByRole("region", { name: "Открытый эфир" })).toHaveTextContent("general");
  });
});

describe("студия гибридного события без онлайн-программы", () => {
  it("объясняет организатору, как добавить онлайн-флоу, и сохраняет общий эфир", async () => {
    mount(owner, "", { activities: [{ ...first, room_is_online: false }] });
    const section = await screen.findByRole("region", { name: "Онлайн-флоу мероприятия" });
    expect(within(section).getByText("Онлайн-флоу пока нет")).toBeVisible();
    expect(within(section).getByRole("link", { name: "Добавить онлайн-флоу" }))
      .toHaveAttribute("href", `#manage/${event.id}/program`);
    expect(within(section).getByRole("link", { name: "Студия общего эфира мероприятия" }))
      .toHaveAttribute("href", `#webinar/${event.id}/general`);
    expect(within(section).queryByText(first.title)).not.toBeInTheDocument();
  });
});
