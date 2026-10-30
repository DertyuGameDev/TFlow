import { env } from "cloudflare:workers";
import { z } from "zod";
import type { ChatGPTUser } from "../app/chatgpt-auth";
import { demoCommunities, demoEvents } from "./demo";

export class FlowError extends Error {
  constructor(public status: number, message: string, public code = "INVALID_REQUEST") { super(message); }
}
export function database(): D1Database {
  if (!env.DB) throw new FlowError(503, "База данных ещё не подключена. Попробуйте позже.");
  return env.DB;
}
export const eventInput = z.object({
  title: z.string().trim().min(3).max(160), description: z.string().trim().min(10).max(5000),
  starts_at: z.number().int().positive().safe(), ends_at: z.number().int().positive().safe(),
  city: z.string().trim().min(2).max(80), venue: z.string().trim().min(2).max(160),
  address: z.string().trim().max(240).default(""), format: z.enum(["Очно", "Онлайн", "Гибрид"]),
  topic: z.string().trim().min(2).max(80), kind: z.string().trim().min(2).max(60),
  cover: z.enum(["yellow", "photo", "blue", "mint", "peach", "violet"]),
  community_id: z.string().max(80).nullable().default(null),
}).refine(v => v.ends_at > v.starts_at, { message: "Дата окончания должна быть позже начала" });
export const roomInput = z.object({ name: z.string().trim().min(2).max(120), capacity: z.number().int().min(1).max(10000) });
export const activityInput = z.object({
  title: z.string().trim().min(3).max(160), description: z.string().trim().max(5000),
  room_id: z.string().min(1).max(100), speaker: z.string().trim().max(160).default(""),
  starts_at: z.number().int().positive().safe(), ends_at: z.number().int().positive().safe(),
  capacity: z.number().int().min(1).max(10000),
}).refine(v => v.ends_at > v.starts_at, { message: "Время окончания должно быть позже начала" });
export async function ensureProfile(user: ChatGPTUser) {
  await database().prepare("INSERT OR IGNORE INTO profiles (id,name,email,city,about,interests) VALUES (?,?,?,'Москва','','')")
    .bind(user.userId, user.fullName ?? user.email.split("@")[0], user.email).run();
}
export async function ownedEvent(id: string, user: ChatGPTUser) {
  const event = await database().prepare("SELECT * FROM events WHERE id=?").bind(id).first<{ owner_id: string; status: string; title: string }>();
  if (!event) throw new FlowError(404, "Мероприятие не найдено");
  if (event.owner_id !== user.userId) throw new FlowError(403, "Управлять программой может только организатор этого мероприятия", "FORBIDDEN");
  return event;
}
export const eventSelect = `SELECT e.*, p.name AS organizer,
  (SELECT COUNT(*) FROM bookmarks WHERE event_id=e.id AND user_id=?) AS saved,
  (SELECT COUNT(*) FROM activities WHERE event_id=e.id) AS activity_count,
  (SELECT COUNT(DISTINCT r.user_id) FROM registrations r JOIN activities a ON a.id=r.activity_id WHERE a.event_id=e.id) AS participant_count
  FROM events e JOIN profiles p ON p.id=e.owner_id`;
export const activitySelect = `SELECT a.*, rm.name AS room_name,
  (SELECT COUNT(*) FROM registrations WHERE activity_id=a.id) AS taken,
  (SELECT COUNT(*) FROM registrations WHERE activity_id=a.id AND user_id=?) AS registered
  FROM activities a JOIN rooms rm ON rm.id=a.room_id`;
export async function bootstrap(user: ChatGPTUser | null) {
  const db = database(), uid = user?.userId ?? "";
  if (user) await ensureProfile(user);
  const [events, schedule, communities, notices, profile] = await Promise.all([
    db.prepare(`${eventSelect} WHERE e.status='published' OR e.owner_id=? ORDER BY e.starts_at`).bind(uid, uid).all(),
    db.prepare(`SELECT a.*, rm.name AS room_name,e.title AS event_title,e.city,e.venue,e.cover AS event_cover,1 AS registered,
      (SELECT COUNT(*) FROM registrations WHERE activity_id=a.id) AS taken
      FROM registrations r JOIN activities a ON a.id=r.activity_id JOIN rooms rm ON rm.id=a.room_id JOIN events e ON e.id=a.event_id
      WHERE r.user_id=? ORDER BY a.starts_at`).bind(uid).all(),
    db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM memberships WHERE community_id=c.id) AS member_count,
      (SELECT COUNT(*) FROM memberships WHERE community_id=c.id AND user_id=?) AS joined FROM communities c ORDER BY c.name`).bind(uid).all(),
    db.prepare("SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 50").bind(uid).all(),
    user ? db.prepare("SELECT * FROM profiles WHERE id=?").bind(uid).first() : Promise.resolve(null),
  ]);
  return { events: events.results, schedule: schedule.results, communities: communities.results, notifications: notices.results, profile };
}
export async function detail(id: string, user: ChatGPTUser | null) {
  const db = database(), uid = user?.userId ?? "";
  const event = await db.prepare(`${eventSelect} WHERE e.id=? AND (e.status='published' OR e.owner_id=?)`).bind(uid, id, uid).first();
  if (!event) throw new FlowError(404, "Мероприятие не найдено");
  const [rooms, activities] = await Promise.all([
    db.prepare("SELECT * FROM rooms WHERE event_id=? ORDER BY name").bind(id).all(),
    db.prepare(`${activitySelect} WHERE a.event_id=? ORDER BY a.starts_at,a.title`).bind(uid, id).all(),
  ]);
  return { event, rooms: rooms.results, activities: activities.results };
}
export async function initializeDemo(user: ChatGPTUser) {
  const db = database();
  await ensureProfile(user);
  const now = Date.now();
  const statements = demoCommunities.map(c => db.prepare("INSERT OR IGNORE INTO communities (id,name,description,topic,color) VALUES (?,?,?,?,?)").bind(...c));
  const demo = demoEvents(user.userId, now);
  const titles = [
    ["AI без магии: от задачи к решению", "Практикум: собираем AI-помощника", "Разбор ваших проектов"],
    ["Проверка идеи до первой строчки кода", "Как разговаривать с пользователями", "Первые продажи продукта"],
    ["Интерфейс начинается с человека", "Дизайн-разбор: от проблемы к решению", "Практика продуктовых исследований"],
    ["Открытие и разбор задач", "Архитектура рабочего прототипа", "Питч проектов"],
    ["Куда расти в технологиях", "Резюме и портфолио на практике", "Как пройти собеседование"],
    ["Открытая лаборатория", "Данные как инструмент исследования", "Инженерная мастерская"],
  ];
  demo.forEach((e, i) => {
    statements.push(db.prepare(`INSERT OR IGNORE INTO events
      (id,owner_id,title,description,starts_at,ends_at,city,venue,address,format,topic,kind,cover,status,community_id,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'published',?,?)`).bind(e.id,e.owner,e.title,e.description,e.start,e.end,e.city,e.venue,e.address,e.format,e.topic,e.kind,e.cover,e.community,e.now));
    for (let r = 0; r < 2; r++) statements.push(db.prepare("INSERT OR IGNORE INTO rooms (id,event_id,name,capacity) VALUES (?,?,?,?)")
      .bind(`${e.id}-room${r}`,e.id,r ? "Практическая лаборатория" : "Главный зал",r ? 20 : 80));
    for (let a = 0; a < 3; a++) statements.push(db.prepare(`INSERT OR IGNORE INTO activities
      (id,event_id,room_id,title,description,speaker,starts_at,ends_at,capacity,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .bind(`${e.id}-a${a}`,e.id,`${e.id}-room${a === 1 ? 1 : 0}`,titles[i][a],"Практическая сессия с экспертом. Разберём примеры, ответим на вопросы и обсудим ваши задачи.",["Анна Миронова", "Александр Волков", "Мария Соколова"][a],e.start+(a===2?4:a)*3600000,e.start+(a===2?5:a+2)*3600000,a===1?20:80,now));
  });
  // Idempotent and transactional: only the first caller owns these demonstration events.
  await db.batch(statements);
  return { ok: true };
}
export const errorMessages: Record<string,string> = {
  ALREADY_REGISTERED: "Вы уже записаны на эту активность",
  NO_SEATS: "Свободные места закончились. Выберите другую активность",
  PARTICIPANT_CONFLICT: "Это время занято другой активностью в вашем расписании",
  ENROLLED_CONFLICT: "Перенос создаёт пересечение у зарегистрированных участников. Выберите другое время",
  ROOM_CONFLICT: "В этой аудитории уже проходит другая активность. Измените время или аудиторию",
  ROOM_CAPACITY: "Лимит участников превышает вместимость аудитории",
  BELOW_REGISTERED: "Нельзя уменьшить лимит ниже числа зарегистрированных участников",
  EVENT_DATES: "Активности должны проходить в пределах дат мероприятия",
  INVALID_TIME: "Время окончания должно быть позже начала",
  INVALID_CAPACITY: "Вместимость должна быть целым числом от 1 до 10 000",
  NOT_PUBLISHED: "Регистрация на неопубликованную программу недоступна",
  REGISTRATION_CLOSED: "Регистрация закрыта: активность уже началась",
};
