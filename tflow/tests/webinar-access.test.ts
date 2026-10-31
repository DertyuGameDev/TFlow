import { describe, expect, it } from "vitest";
import { canEnterWebinar, hasWebinar, webinarConnectionIssue } from "../lib/webinars";
import { fromLocalInput, localInput } from "../lib/time";
import { event } from "./fixtures";

describe("кнопка входа в вебинар", () => {
  const online = { ...event, format: "Онлайн" };
  it("предлагает комнату только онлайн- и гибридным событиям", () => {
    expect(hasWebinar(event)).toBe(false);
    expect(hasWebinar(online)).toBe(true);
    expect(hasWebinar({ ...event, format: "Гибрид" })).toBe(true);
  });
  it("гостю, незаписанному пользователю и черновику не предлагает вход", () => {
    expect(canEnterWebinar(online, undefined, event.starts_at)).toBe(false);
    expect(canEnterWebinar(online, "stranger", event.starts_at)).toBe(false);
    expect(canEnterWebinar({ ...online, status: "draft", enrolled: 1 }, "person", event.starts_at)).toBe(false);
  });
  it("даёт организатору студию, участнику с билетом — вход до окончания", () => {
    expect(canEnterWebinar(online, event.owner_id, event.ends_at - 1)).toBe(true);
    expect(canEnterWebinar({ ...online, enrolled: 1 }, "person", event.ends_at - 1)).toBe(true);
  });
  it("закрывает вход ровно в момент окончания, как и сервер", () => {
    expect(canEnterWebinar({ ...online, enrolled: 1 }, "person", event.ends_at)).toBe(false);
    expect(canEnterWebinar(online, event.owner_id, event.ends_at + 1)).toBe(false);
  });
});

describe("адрес видеосервера на виртуальной машине", () => {
  const remote = { protocol: "https:", hostname: "events.example.test" };
  it("запрещает смешанное HTTP/HTTPS подключение и localhost на удалённом сайте", () => {
    expect(webinarConnectionIssue("ws://video.example.test", remote)).toContain("WSS");
    expect(webinarConnectionIssue("wss://localhost:7880", remote)).toContain("localhost");
    expect(webinarConnectionIssue("wss://[::1]:7880", remote)).toContain("localhost");
  });
  it("оставляет локальную разработку и корректный публичный WSS", () => {
    expect(webinarConnectionIssue("ws://127.0.0.1:7880", { protocol: "http:", hostname: "localhost" })).toBeNull();
    expect(webinarConnectionIssue("wss://events.example.test/livekit", remote)).toBeNull();
    expect(webinarConnectionIssue("invalid", remote)).toContain("некорректный");
    expect(webinarConnectionIssue("https://events.example.test", remote)).toContain("WebSocket");
  });
});

describe("даты формы события по Москве", () => {
  it("ввод и отображение сохраняют минуту на границе дня и месяца", () => {
    for (const value of ["2026-12-31T23:59", "2028-02-29T00:01", "2026-03-29T03:30"])
      expect(localInput(fromLocalInput(value))).toBe(value);
  });
});
