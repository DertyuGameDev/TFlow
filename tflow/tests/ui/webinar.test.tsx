import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RoomEvent } from "livekit-client";
import Webinar from "../../app/ui/webinar";
import { deferred, event } from "../fixtures";
import type { Activity } from "../../lib/types";

const media = vi.hoisted(() => {
  class TestRoom {
    static getLocalDevices = vi.fn().mockResolvedValue([]);
    listeners = new Map<string, Set<(...args: unknown[]) => void>>();
    canPlaybackAudio = true;
    remoteParticipants = new Map();
    localParticipant = {
      isMicrophoneEnabled: false, isCameraEnabled: false, isScreenShareEnabled: false,
      audioLevel: 0, isSpeaking: false,
      getTrackPublication: vi.fn(), audioTrackPublications: new Map(),
      setMicrophoneEnabled: vi.fn(async (enabled: boolean) => {
        this.localParticipant.isMicrophoneEnabled = enabled;
        this.emit(enabled ? "trackUnmuted" : "trackMuted");
      }),
      setCameraEnabled: vi.fn().mockResolvedValue(undefined),
      setScreenShareEnabled: vi.fn().mockResolvedValue(undefined),
      publishData: vi.fn().mockResolvedValue(undefined),
    };
    startAudio = vi.fn().mockResolvedValue(undefined);
    connect = vi.fn().mockResolvedValue(undefined);
    disconnect = vi.fn().mockResolvedValue(undefined);
    switchActiveDevice = vi.fn().mockResolvedValue(true);
    on(name: string, fn: (...args: unknown[]) => void) {
      if (!this.listeners.has(name)) this.listeners.set(name, new Set());
      this.listeners.get(name)!.add(fn); return this;
    }
    off(name: string, fn: (...args: unknown[]) => void) { this.listeners.get(name)?.delete(fn); return this; }
    emit(name: string) { for (const fn of this.listeners.get(name) ?? []) fn(); }
  }
  return { TestRoom, rooms: [] as TestRoom[] };
});
vi.mock("livekit-client", async importOriginal => {
  const actual = await importOriginal<typeof import("livekit-client")>();
  class Room extends media.TestRoom { constructor() { super(); media.rooms.push(this); } }
  return { ...actual, Room };
});
vi.mock("../../lib/screen-share", async importOriginal => ({
  ...await importOriginal<typeof import("../../lib/screen-share")>(),
  screenShareContext: () => ({ secure: true, supported: true, allowedByPolicy: true, embedded: false }),
}));
const online = { ...event, format: "Онлайн" };
const host = { userId: event.owner_id, role: "organizer" as const, displayName: "Ведущий", email: "host@example.test", fullName: "Ведущий" };
function sender() {
  return vi.fn(async (_path: string, method: string) => method === "GET"
    ? { configured: true, host: true, active: false, session: null, ended: false, published: true }
    : { url: "ws://video.example.test", token: "test-token", session: "session-one", host: true });
}
async function enter() {
  const user = userEvent.setup(), send = sender();
  const view = render(<Webinar event={online} user={host} send={send} />);
  await user.click(await screen.findByRole("button", { name: "Начать эфир" }));
  await screen.findByRole("button", { name: "Включить микрофон" });
  return { user, send, view, room: media.rooms[0] };
}
beforeEach(() => { media.rooms.length = 0; });
afterEach(() => { vi.useRealTimers(); });

describe("полноэкранный режим вебинара", () => {
  afterEach(() => {
    Reflect.deleteProperty(document, "fullscreenElement");
    Reflect.deleteProperty(document, "exitFullscreen");
  });

  it("переключает вход и выход одной кнопкой, учитывает Esc и сохраняет соединение", async () => {
    const { user, room, send } = await enter();
    const stage = screen.getByRole("button", { name: "На весь экран" }).parentElement!;
    let current: Element | null = null;
    Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => current });
    const changed = () => document.dispatchEvent(new Event("fullscreenchange"));
    const request = vi.fn(async () => { current = stage; changed(); });
    const exit = vi.fn(async () => { current = null; changed(); });
    Object.defineProperty(stage, "requestFullscreen", { configurable: true, value: request });
    Object.defineProperty(document, "exitFullscreen", { configurable: true, value: exit });
    const callsBefore = send.mock.calls.length;
    await user.click(screen.getByRole("button", { name: "На весь экран" }));
    expect(screen.getByRole("button", { name: "Выйти из полноэкранного режима" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Выйти из полноэкранного режима" }));
    expect(exit).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "На весь экран" })).toHaveAttribute("aria-pressed", "false");
    await user.click(screen.getByRole("button", { name: "На весь экран" }));
    // Esc and the browser's own fullscreen control emit this same event.
    act(() => { current = null; changed(); });
    expect(screen.getByRole("button", { name: "На весь экран" })).toHaveAttribute("aria-pressed", "false");
    expect(request).toHaveBeenCalledTimes(2);
    expect(room.disconnect).not.toHaveBeenCalled();
    expect(room.connect).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledTimes(callsBefore);
  });

  it("обрабатывает отказ браузера и отсутствие API без отключения эфира", async () => {
    const { user, room } = await enter();
    const button = screen.getByRole("button", { name: "На весь экран" });
    const stage = button.parentElement!;
    Object.defineProperty(stage, "requestFullscreen", {
      configurable: true, value: vi.fn().mockRejectedValue(new DOMException("Blocked", "NotAllowedError")),
    });
    await user.click(button);
    expect(await screen.findByRole("alert")).toHaveTextContent("Полноэкранный режим недоступен");
    expect(button).toHaveAttribute("aria-pressed", "false");
    Object.defineProperty(stage, "requestFullscreen", { configurable: true, value: undefined });
    await user.click(button);
    expect(screen.getByRole("alert")).toHaveTextContent("Откройте вебинар в обычной вкладке");
    expect(room.disconnect).not.toHaveBeenCalled();
    expect(room.connect).toHaveBeenCalledOnce();
  });
});

describe("комната вебинара", () => {
  it("подтверждает посещение только после соединения, а ошибка учёта не отключает зрителя", async () => {
    const user=userEvent.setup(), pending=deferred<void>();
    const send=vi.fn(async(_path:string,method:string,body?:unknown)=>{
      if(method==="GET") return {configured:true,host:false,active:true,session:"session-one",ended:false,published:true};
      if((body as {operation:string}).operation==="confirm") throw new Error("Temporary attendance failure");
      return {url:"ws://video.example.test",token:"test-token",session:"session-one",host:false};
    });
    render(<Webinar event={online} user={{...host,userId:"viewer",role:"participant"}} send={send}/>);
    await screen.findByRole("button",{name:"Войти в вебинар"});
    // The connection is controlled on the newly-created test room during join.
    send.mockImplementationOnce(async()=>{const room=media.rooms[0]; room.connect.mockImplementationOnce(()=>pending.promise); return {url:"ws://video.example.test",token:"test-token",session:"session-one",host:false};});
    await user.click(screen.getByRole("button",{name:"Войти в вебинар"}));
    expect(send.mock.calls.some((call)=>(call[2] as {operation?:string})?.operation==="confirm")).toBe(false);
    await act(async()=>pending.resolve());
    await waitFor(()=>expect(send).toHaveBeenCalledWith(`events/${event.id}/webinar`,"POST",{operation:"confirm",session:"session-one"}));
    expect(await screen.findByText(/Посещение пока не подтверждено/)).toBeVisible();
    expect(media.rooms[0].disconnect).not.toHaveBeenCalled();
    expect(screen.getByRole("button",{name:"Подтвердить посещение"})).toBeEnabled();
  });
  it("не отключает комнату устаревшим статусом во время долгого старта на VM", async () => {
    vi.useFakeTimers();
    const access = deferred<unknown>(), connection = deferred<void>();
    const send = vi.fn(async (_path: string, method: string) => method === "GET"
      ? { configured: true, host: true, active: false, session: null, ended: false, published: true }
      : access.promise);
    render(<Webinar event={online} user={host} send={send} />);
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Начать эфир" }));
    const room = media.rooms[0];
    room.connect.mockImplementationOnce(() => connection.promise);
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(send.mock.calls.filter(([, method]) => method === "GET")).toHaveLength(1);
    await act(async () => access.resolve({ url: "ws://video.example.test", token: "test-token", session: "new-session", host: true }));
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(room.disconnect).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Подключаемся…" })).toBeDisabled();
    await act(async () => connection.resolve());
    expect(screen.getByRole("button", { name: "Выйти из комнаты" })).toBeEnabled();
  });

  it("объясняет, почему старт выключен, и позволяет повторно проверить настройку", async () => {
    const user = userEvent.setup();
    const send = vi.fn().mockResolvedValueOnce({
      configured: false, configuration_error: "На сервере не настроены адрес и ключи LiveKit.",
      host: true, active: false, session: null, ended: false, published: true,
    }).mockResolvedValue({ configured: true, host: true, active: false, session: null, ended: false, published: true });
    render(<Webinar event={online} user={host} send={send} />);
    expect(await screen.findByText("Видеосервер не настроен")).toBeVisible();
    expect(screen.getByText("На сервере не настроены адрес и ключи LiveKit.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Начать эфир" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Проверить подключение" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Начать эфир" })).toBeEnabled());
  });


  it("два онлайн-флоу используют разные API и комнаты, завершение одного не отключает второй", async () => {
    const base: Activity = { id: "python", event_id: event.id, room_id: "online-one", room_name: "Python",
      title: "Python", description: "", speaker: "", starts_at: event.starts_at, ends_at: event.ends_at,
      capacity: 20, taken: 0, registered: 0, waitlisted: 0, waiting_count: 0, waitlist_position: 0, updated_at: 1, room_is_online: true };
    const second = { ...base, id: "django", room_id: "online-two", title: "Django", room_name: "Django" };
    const states = new Map<string, boolean>();
    const send = vi.fn(async (path: string, method: string, body?: unknown) => {
      const operation = (body as { operation?: string } | undefined)?.operation;
      if (operation) states.set(path, operation !== "end");
      return method === "GET"
        ? { configured: true, host: true, active: !!states.get(path), session: path, ended: false, published: true }
        : { url: "ws://video.example.test", token: `token-${path}`, session: path, host: true };
    });
    const user = userEvent.setup();
    render(<><Webinar event={online} activity={base} user={host} send={send} /><Webinar event={online} activity={second} user={host} send={send} /></>);
    const one = await screen.findByRole("region", { name: "Вебинар флоу: Python" });
    const two = screen.getByRole("region", { name: "Вебинар флоу: Django" });
    await user.click(await within(one).findByRole("button", { name: "Начать эфир" }));
    await user.click(await within(two).findByRole("button", { name: "Начать эфир" }));
    expect(media.rooms).toHaveLength(2);
    expect(media.rooms[0].connect).toHaveBeenCalledWith("ws://video.example.test", "token-activities/python/webinar");
    expect(media.rooms[1].connect).toHaveBeenCalledWith("ws://video.example.test", "token-activities/django/webinar");
    await user.type(within(one).getByRole("textbox", { name: "Сообщение в чат" }), "Только Python");
    await user.click(within(one).getByRole("button", { name: "Отправить" }));
    expect(within(one).getByLabelText("Сообщения эфира")).toHaveTextContent("Только Python");
    expect(within(two).getByLabelText("Сообщения эфира")).not.toHaveTextContent("Только Python");
    expect(media.rooms[1].localParticipant.publishData).not.toHaveBeenCalled();
    await user.click(within(one).getByRole("button", { name: "Завершить эфир" }));
    await user.click(screen.getByRole("button", { name: "Да, завершить эфир" }));
    expect(send).toHaveBeenCalledWith("activities/python/webinar", "POST", { operation: "end" });
    expect(media.rooms[0].disconnect).toHaveBeenCalledOnce();
    expect(media.rooms[1].disconnect).not.toHaveBeenCalled();
    expect(within(two).getByRole("button", { name: "Выйти из комнаты" })).toBeVisible();
  });
  it("вход не запрашивает микрофон/камеру автоматически и выход отключает комнату", async () => {
    const { user, room, view } = await enter();
    expect(room.startAudio).toHaveBeenCalledOnce();
    expect(room.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();
    expect(room.localParticipant.setCameraEnabled).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Выйти из комнаты" }));
    await waitFor(() => expect(room.disconnect).toHaveBeenCalledOnce());
    view.unmount();
    expect(room.disconnect).toHaveBeenCalledOnce();
  });

  it("микрофон зеленеет по серверному событию речи и гаснет сразу при выключении", async () => {
    const { user, room } = await enter();
    await user.click(screen.getByRole("button", { name: "Включить микрофон" }));
    const enabled = screen.getByRole("button", { name: "Выключить микрофон" });
    expect(enabled).toHaveAttribute("aria-pressed", "true");
    expect(enabled).not.toHaveClass("is-speaking");
    await act(async () => {
      room.localParticipant.audioLevel = .6;
      room.localParticipant.isSpeaking = true;
      room.emit(RoomEvent.ActiveSpeakersChanged);
    });
    expect(enabled).toHaveClass("is-speaking");
    expect(screen.getByRole("meter", { name: "Уровень микрофона" })).toHaveAttribute("aria-valuenow", "3");
    await user.click(enabled);
    expect(screen.getByRole("button", { name: "Включить микрофон" })).not.toHaveClass("is-speaking");
    expect(screen.getByRole("meter", { name: "Уровень микрофона" })).toHaveAttribute("aria-valuenow", "0");
  });

  it("отказ доступа не изображает включённый микрофон и допускает повтор", async () => {
    const { user, room } = await enter();
    room.localParticipant.setMicrophoneEnabled.mockRejectedValueOnce(new DOMException("denied", "NotAllowedError"));
    await user.click(screen.getByRole("button", { name: "Включить микрофон" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Разрешите доступ к микрофону");
    expect(screen.getByRole("button", { name: "Включить микрофон" })).toHaveAttribute("aria-pressed", "false");
    await user.click(screen.getByRole("button", { name: "Включить микрофон" }));
    expect(await screen.findByRole("button", { name: "Выключить микрофон" })).toHaveAttribute("aria-pressed", "true");
  });

  it("ошибка смены устройства сохраняет выбор и объясняет проблему", async () => {
    media.TestRoom.getLocalDevices.mockResolvedValueOnce([
      { deviceId: "second-mic", label: "Второй микрофон", kind: "audioinput" },
    ]);
    const { user, room } = await enter();
    await user.click(screen.getByRole("button", { name: "Включить микрофон" }));
    await screen.findByRole("option", { name: "Второй микрофон" });
    room.switchActiveDevice.mockRejectedValueOnce(new DOMException("busy", "NotReadableError"));
    await user.selectOptions(screen.getByRole("combobox", { name: "Выбрать микрофон" }), "second-mic");
    expect(await screen.findByRole("alert")).toHaveTextContent("другой микрофон");
    expect(screen.getByRole("combobox", { name: "Выбрать микрофон" })).toHaveValue("default");
  });

  it("отправляет по Enter, оставляет Shift+Enter для новой строки и сохраняет отправку кнопкой", async () => {
    const { user, room } = await enter();
    const input = screen.getByRole("textbox", { name: "Сообщение в чат" });
    await user.type(input, "Первая строка");
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    await user.type(input, "Вторая строка");
    expect(input).toHaveValue("Первая строка\nВторая строка");
    expect(room.localParticipant.publishData).not.toHaveBeenCalled();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(input).toHaveValue(""));
    expect(input).toHaveFocus();
    expect(room.localParticipant.publishData).toHaveBeenCalledExactlyOnceWith(
      new TextEncoder().encode(JSON.stringify({ text: "Первая строка\nВторая строка" })),
      { reliable: true, topic: "tflow-chat" },
    );
    expect(screen.getByLabelText("Сообщения эфира")).toHaveTextContent("Первая строка Вторая строка");
    await user.type(input, "С кнопки");
    await user.click(screen.getByRole("button", { name: "Отправить" }));
    await waitFor(() => expect(room.localParticipant.publishData).toHaveBeenCalledTimes(2));
    expect(input).toHaveValue("");
  });

  it("не отправляет пустой текст и не дублирует сообщение во время отправки", async () => {
    const { user, room } = await enter();
    const input = screen.getByRole("textbox", { name: "Сообщение в чат" });
    await user.type(input, "   ");
    await user.keyboard("{Enter}");
    expect(room.localParticipant.publishData).not.toHaveBeenCalled();
    await user.clear(input);
    await user.type(input, "Один раз");
    const sending = deferred<void>();
    room.localParticipant.publishData.mockImplementationOnce(() => sending.promise);
    await user.keyboard("{Enter}{Enter}");
    expect(room.localParticipant.publishData).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Отправить" })).toBeDisabled();
    await act(async () => sending.resolve());
    expect(input).toHaveValue("");
  });

  it("не отправляет при подтверждении ввода IME и удержании Enter", async () => {
    const { user, room } = await enter();
    const input = screen.getByRole("textbox", { name: "Сообщение в чат" });
    await user.type(input, "Сообщение");
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
    fireEvent.keyDown(input, { key: "Enter", repeat: true });
    expect(room.localParticipant.publishData).not.toHaveBeenCalled();
    expect(input).toHaveValue("Сообщение");
    await user.keyboard("{Enter}");
    expect(room.localParticipant.publishData).toHaveBeenCalledOnce();
  });
});
