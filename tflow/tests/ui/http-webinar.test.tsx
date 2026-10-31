import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import HttpWebinar from "../../app/ui/http-webinar";
import { event } from "../fixtures";

vi.mock("hls.js", () => ({ default: class { static isSupported() { return false; } } }));
const waiting = { host: false, active: false, configured: true, ended: false, published: true, session: null };
beforeEach(() => {
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
