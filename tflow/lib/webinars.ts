import type { FlowEvent } from "./types";

export function webinarChatAuthor(email: string, fallback = "Участник") {
  return email.trim().split("@", 1)[0] || fallback.trim() || "Участник";
}

export const webinarPath = (eventId: string, activityId?: string) =>
  `#webinar/${encodeURIComponent(eventId)}${activityId ? `/${encodeURIComponent(activityId)}` : ""}`;

export const hasWebinar = (event: FlowEvent) =>
  event.format === "Онлайн" || event.format === "Гибрид";

export const canEnterWebinar = (
  event: FlowEvent,
  userId: string | undefined,
  now = Date.now(),
) =>
  hasWebinar(event) &&
  event.status === "published" &&
  event.ends_at > now &&
  !!userId &&
  (event.enrolled > 0 || event.owner_id === userId);

export function webinarConnectionIssue(address: string, page: Pick<Location, "protocol" | "hostname">): string | null {
  let url: URL;
  try { url = new URL(address); } catch { return "Сервер вернул некорректный адрес видеосвязи."; }
  if (!["ws:", "wss:"].includes(url.protocol)) return "Для видеосвязи нужен WebSocket-адрес. Обратитесь к администратору сайта.";
  if (page.protocol === "https:" && url.protocol !== "wss:")
    return "Сайт открыт по HTTPS, но видеосервер настроен без защищённого соединения. Администратору нужно указать WSS-адрес.";
  const local = (hostname: string) => ["localhost", "127.0.0.1", "[::1]", "::1"].includes(hostname);
  if (local(url.hostname) && !local(page.hostname))
    return "Видеосервер настроен на localhost вместо публичного адреса. С другого компьютера подключиться нельзя — администратору нужно исправить адрес.";
  return null;
}
