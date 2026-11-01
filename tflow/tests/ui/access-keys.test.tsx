import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LecturerLinks } from "../../app/ui/lecturer-links";
import { AccessKeyManager, KeyAccessPage } from "../../app/ui/access-keys";
import { ApiError } from "../../lib/api-error";
import type { Activity } from "../../lib/types";
import type { Send } from "../../app/ui/forms";
import { event, profile } from "../fixtures";

vi.mock("../../app/ui/webinar", () => ({ default: ({ activity, send, delegated }: { activity: Activity; send: Send; delegated: boolean }) =>
  <section aria-label="Студия по ключу"><p>{activity.title}</p><p>{delegated ? "Делегированный ведущий" : "Владелец"}</p>
    <button onClick={() => void send(`activities/${activity.id}/webinar`, "GET")}>Проверить эфир</button>
    <button onClick={() => void send(`activities/${activity.id}/webinar`, "POST", { operation: "start" })}>Начать эфир</button>
  </section> }));
const user = { userId: profile.id, displayName: profile.name, fullName: profile.name, email: profile.email, role: profile.role };
const secret = "generated-test-key-with-at-least-32-characters";
const activity: Activity = { id: "flow-python", event_id: event.id, room_id: "virtual", room_name: "Python", title: "Python",
  description: "", speaker: "", starts_at: event.starts_at, ends_at: event.ends_at, capacity: 20, taken: 0,
  registered: 0, waitlisted: 0, waiting_count: 0, waitlist_position: 0, updated_at: 1, room_is_online: true };

describe("ключи доверенных лиц в кабинете", () => {
  it("создаёт ключ сканера, показывает его только после создания и отзывает", async () => {
    let active = false;
    const meta = { id: "key-one", expires_at: event.ends_at, users: 0 };
    const send = vi.fn(async (_path: string, method: string, body?: unknown) => {
      if (method === "GET") return { scan_key: active ? meta : null, activities: [] };
      active = (body as { operation: string }).operation === "issue";
      return active ? { ...meta, key: secret } : { ok: true };
    });
    const person = userEvent.setup();
    render(<AccessKeyManager event={event} send={send}/>);
    expect(send).not.toHaveBeenCalled();
    await person.click(screen.getByRole("button", { name: "Управлять ключами" }));
    await person.click(await screen.findByRole("button", { name: "Создать ключ" }));
    expect(await screen.findByLabelText("Ключ: Сканер всего мероприятия")).toHaveValue(secret);
    expect(send).toHaveBeenCalledWith(`events/${event.id}/access-keys`, "POST", { purpose: "scan", activity_id: null, operation: "issue" });
    await person.click(screen.getByRole("button", { name: "Скрыть ключ" }));
    expect(screen.queryByLabelText("Ключ: Сканер всего мероприятия")).not.toBeInTheDocument();
    await person.click(screen.getByRole("button", { name: "Отозвать" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Создать ключ" })).toBeEnabled());
    expect(send).toHaveBeenCalledWith(`events/${event.id}/access-keys`, "POST", { purpose: "scan", activity_id: null, operation: "revoke" });
  });

  it("ссылки лектора относятся к конкретным активностям", async () => {
    const rows=[{id:"python",title:"Python",credential:secret,key_id:"one",starts_at:event.starts_at,ends_at:event.ends_at},{id:"django",title:"Django",credential:secret+"two",key_id:"two",starts_at:event.starts_at,ends_at:event.ends_at}];
    const send=vi.fn().mockResolvedValue({activities:rows});
    render(<LecturerLinks event={event} send={send}/>);
    expect(await screen.findByLabelText("Ссылка лектора: Django")).toHaveValue(`${location.origin}/#lecture/${secret}two`);
    await userEvent.click(within(screen.getByRole("heading",{name:"Django"}).closest("li")!).getByRole("button",{name:"Обновить ссылку"}));
    expect(send).toHaveBeenLastCalledWith(`events/${event.id}/lecturer-links`,"POST",{activity_id:"django",operation:"issue"});
  });
});

async function enterKey() {
  const person = userEvent.setup();
  await person.type(screen.getByLabelText("Токен организатора"), secret);
  await person.click(screen.getByRole("button", { name: "Открыть доступ" }));
  return person;
}

describe("доступ доверенного лица", () => {
  it("гость сначала входит в свой аккаунт без передачи ключа через URL", () => {
    const send = vi.fn();
    render(<KeyAccessPage user={null} send={send}/>);
    expect(screen.getByRole("link", { name: "Войти в свой аккаунт" })).toHaveAttribute("href", "/login/?next=%2F%23scan");
    expect(screen.queryByLabelText("Токен организатора")).not.toBeInTheDocument();
    expect(send).not.toHaveBeenCalled();
  });

  it("по QR-ключу отмечает вход только через отдельный API, без показа контактов", async () => {
    const send = vi.fn(async (path: string) => path === "access-keys/resolve"
      ? { purpose: "scan", event, activity: null, expires_at: event.ends_at }
      : { admitted: true, already_checked_in: false, checked_in_at: event.starts_at, attendee: { id: profile.id, name: profile.name, activities: [] } });
    render(<KeyAccessPage user={user} send={send}/>);
    const person = await enterKey();
    await person.click(await screen.findByText("Проверить по ссылке"));
    await person.type(screen.getByLabelText("Ссылка или код из QR"), "participant-pass");
    await person.click(screen.getByRole("button", { name: "Проверить и отметить" }));
    expect(await screen.findByRole("heading", { name: "Вход подтверждён" })).toBeVisible();
    expect(send).toHaveBeenCalledWith("access-keys/check-in", "POST", { qr: "participant-pass", key: secret });
    expect(screen.queryByText(profile.email)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Событие")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox",{name:"Что отмечаем"})).toHaveValue("");
    expect(location.href).not.toContain(secret);
  });

  it("не оставляет успешную отметку на экране после отзыва ключа", async () => {
    const send = vi.fn().mockResolvedValueOnce({ purpose: "scan", event, activity: null, expires_at: event.ends_at })
      .mockRejectedValue(new ApiError({ error: "Ключ отозван", code: "INVALID_SCAN_KEY" }));
    render(<KeyAccessPage user={user} send={send}/>);
    const person = await enterKey();
    await person.click(await screen.findByText("Проверить по ссылке"));
    await person.type(screen.getByLabelText("Ссылка или код из QR"), "participant-pass");
    await person.click(screen.getByRole("button", { name: "Проверить и отметить" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Ключ отозван");
    expect(screen.queryByRole("heading", { name: "Вход подтверждён" })).not.toBeInTheDocument();
  });

  it("ключ ведущего открывает указанную студию и передаётся только в теле POST", async () => {
    const send = vi.fn(async (path: string) => path === "access-keys/resolve"
      ? { purpose: "webinar", event, activity, expires_at: event.ends_at } : { host: true });
    render(<KeyAccessPage user={user} send={send}/>);
    const person = await enterKey();
    const studio = await screen.findByRole("region", { name: "Студия по ключу" });
    expect(within(studio).getByText("Python")).toBeVisible();
    expect(within(studio).getByText("Делегированный ведущий")).toBeVisible();
    await person.click(within(studio).getByRole("button", { name: "Проверить эфир" }));
    await person.click(within(studio).getByRole("button", { name: "Начать эфир" }));
    expect(send).toHaveBeenCalledWith("access-keys/webinar", "POST", { key: secret, operation: "status" });
    expect(send).toHaveBeenCalledWith("access-keys/webinar", "POST", { key: secret, operation: "start" });
    await person.click(screen.getByRole("button", { name: "Закрыть доступ" }));
    expect(screen.queryByRole("region", { name: "Студия по ключу" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Токен организатора")).toHaveValue("");
  });

  it("не открывает инструменты по неверному ключу", async () => {
    render(<KeyAccessPage user={user} send={vi.fn().mockRejectedValue(new Error("Ключ недействителен"))}/>);
    await enterKey();
    expect(await screen.findByRole("alert")).toHaveTextContent("Ключ недействителен");
    expect(screen.queryByRole("region", { name: "Сканер участников" })).not.toBeInTheDocument();
  });
});

it('убирает секрет приглашения из адреса перед входом и восстанавливает его из этой вкладки',async()=>{
  sessionStorage.clear();history.replaceState(null,'',`/#lecture/${secret}`);
  const send=vi.fn().mockResolvedValue({purpose:'webinar',event,activity,expires_at:event.ends_at});
  const guest=render(<KeyAccessPage user={null} send={send} invitationMode invitation={secret}/>);
  await waitFor(()=>expect(location.hash).toBe('#lecture'));
  expect(screen.getByRole('link',{name:'Войти в свой аккаунт'})).toHaveAttribute('href','/login/?next=%2F%23lecture');
  expect(send).not.toHaveBeenCalled();guest.unmount();
  render(<KeyAccessPage user={user} send={send} invitationMode/>);
  expect(await screen.findByRole('region',{name:'Студия по ключу'})).toBeVisible();
  expect(send).toHaveBeenCalledWith('access-keys/resolve','POST',{key:secret});
  expect(location.href).not.toContain(secret);sessionStorage.clear();
});
