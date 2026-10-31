import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import HttpWebinar from "../../app/ui/http-webinar";
import { event } from "../fixtures";

const mse = vi.hoisted(() => ({ supported: false, players: [] as { loadSource: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }[] }));
vi.mock("hls.js", () => ({ default: class {
  static isSupported() { return mse.supported; }
  static Events = { MANIFEST_PARSED: "manifest", ERROR: "error" };
  loadSource = vi.fn(); destroy = vi.fn(); attachMedia = vi.fn(); on = vi.fn();
  constructor() { mse.players.push(this); }
} }));
const waiting = { host: false, active: false, configured: true, ended: false, published: true, session: null };
beforeEach(() => {
  mse.supported = false; mse.players.length = 0;
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => waiting })));
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
});

it("does not fetch private media or chat before the event is live", async () => {
  render(<HttpWebinar event={event} initialStatus={waiting}/>);
  expect(screen.getByRole("button", { name: "Смотреть эфир" })).toBeDisabled();
  await waitFor(() => expect(fetch).toHaveBeenCalled());
  expect(vi.mocked(fetch).mock.calls.every(([url]) => String(url).endsWith("/broadcast"))).toBe(true);
});

it("requires an explicit viewer action and displays preparation instead of a broken video", async () => {
  const live = { ...waiting, active: true, session: "session", ready: false };
  vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: true, json: async () => url.endsWith("/chat") ? { messages: [] } : live })));
  render(<HttpWebinar event={event} initialStatus={live}/>);
  expect(screen.getByLabelText("Видео и звук ведущего")).not.toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Смотреть эфир" }));
  expect(screen.getByRole("status")).toHaveTextContent("Подготавливаем видео");
  expect(screen.getByRole("button", { name: "Выйти из просмотра" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Включить камеру" })).not.toBeInTheDocument();
});

it("blocks an early start and unlocks automatically only after the server allows it", async () => {
  const scheduled = { ...waiting, host: true, scheduled: true, can_start: false, starts_at: "2026-11-01T12:00:00+03:00" };
  let state = scheduled;
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => state })));
  const view = render(<HttpWebinar event={event} initialStatus={scheduled}/>);
  const start = screen.getByRole("button", { name: "Начать эфир" });
  expect(start).toBeDisabled();
  expect(screen.getByText(/До начала можно проверить камеру/)).toHaveTextContent("1 ноября в 12:00 МСК");
  expect(screen.getByRole("button", { name: "Включить камеру" })).toBeEnabled();
  await userEvent.click(start);
  expect(vi.mocked(fetch).mock.calls.every(([, options]) => options?.method !== "POST")).toBe(true);
  state = { ...scheduled, scheduled: false, can_start: true };
  await waitFor(() => expect(start).toBeEnabled(), { timeout: 3500 });
  expect(screen.queryByText(/До начала можно проверить камеру/)).not.toBeInTheDocument();
  view.unmount();
});

it("prefers the HLS.js player when native HLS also advertises support and cleans it up", async () => {
  mse.supported = true;
  vi.spyOn(HTMLMediaElement.prototype, "canPlayType").mockReturnValue("probably");
  const live = { ...waiting, active: true, session: "session", ready: true, playlist: "/api/private/index.m3u8" };
  vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: true, json: async () => url.endsWith("/chat") ? { messages: [] } : live })));
  const view = render(<HttpWebinar event={event} initialStatus={live}/>);
  await userEvent.click(screen.getByRole("button", { name: "Смотреть эфир" }));
  await waitFor(() => expect(mse.players[0]?.loadSource).toHaveBeenCalledWith(live.playlist));
  expect(screen.getByLabelText("Видео и звук ведущего")).not.toHaveAttribute("src");
  view.unmount();
  expect(mse.players[0].destroy).toHaveBeenCalled();
});
