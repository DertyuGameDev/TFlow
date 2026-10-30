import { z } from "zod";
import { getChatGPTUser } from "../../chatgpt-auth";
import { activityInput, bootstrap, database, detail, ensureProfile, errorMessages, eventInput, FlowError, initializeDemo, ownedEvent, roomInput } from "../../../lib/server";

export const dynamic = "force-dynamic";
const response = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
async function handle(request: Request, context: { params: Promise<{ path: string[] }> }) {
  try {
    const { path } = await context.params;
    const [resource, id, action] = path;
    const user = await getChatGPTUser();
    const method = request.method;
    if (method === "GET") {
      if (resource === "bootstrap") return response(await bootstrap(user));
      if (resource === "events" && id && !action) return response(await detail(id, user));
      if (resource === "events" && id && action === "participants") {
        if (!user) throw new FlowError(401, "Войдите в аккаунт");
        await ownedEvent(id, user);
        return response((await database().prepare(`SELECT p.id,p.name,p.email,a.id AS activity_id,a.title AS activity_title,r.created_at
          FROM registrations r JOIN profiles p ON p.id=r.user_id JOIN activities a ON a.id=r.activity_id
          WHERE a.event_id=? ORDER BY a.starts_at,p.name`).bind(id).all()).results);
      }
      throw new FlowError(404, "Страница не найдена");
    }
    const origin = request.headers.get("origin");
    if ((origin && origin !== new URL(request.url).origin) || request.headers.get("sec-fetch-site") === "cross-site")
      throw new FlowError(403, "Запрос с другого сайта отклонён", "FORBIDDEN");
    if (!user) throw new FlowError(401, "Войдите, чтобы продолжить", "UNAUTHORIZED");
    await ensureProfile(user);
    const db = database();
    const body = method === "DELETE" ? {} : await request.json().catch(() => { throw new FlowError(400, "Не удалось прочитать данные формы"); });
    const now = Date.now();

    if (resource === "demo" && method === "POST") return response(await initializeDemo(user));
    if (resource === "profile" && method === "PATCH") {
      const v = z.object({ name: z.string().trim().min(2).max(80), city: z.string().trim().min(2).max(80), about: z.string().trim().max(1000), interests: z.string().trim().max(300) }).parse(body);
      await db.prepare("UPDATE profiles SET name=?,city=?,about=?,interests=? WHERE id=?").bind(v.name,v.city,v.about,v.interests,user.userId).run();
      return response({ ok: true });
    }
    if (resource === "notifications" && method === "PATCH") {
      await db.prepare("UPDATE notifications SET read=1 WHERE user_id=?").bind(user.userId).run();
      return response({ ok: true });
    }
    if (resource === "communities" && id && action === "join") {
      if (method === "POST") await db.prepare("INSERT OR IGNORE INTO memberships (user_id,community_id) VALUES (?,?)").bind(user.userId,id).run();
      else if (method === "DELETE") await db.prepare("DELETE FROM memberships WHERE user_id=? AND community_id=?").bind(user.userId,id).run();
      else throw new FlowError(405, "Метод не поддерживается");
      return response({ ok: true });
    }
    if (resource === "events") {
      if (!id && method === "POST") {
        const v = eventInput.parse(body), eid = crypto.randomUUID();
        await db.prepare(`INSERT INTO events
          (id,owner_id,title,description,starts_at,ends_at,city,venue,address,format,topic,kind,cover,status,community_id,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'draft',?,?)`).bind(eid,user.userId,v.title,v.description,v.starts_at,v.ends_at,v.city,v.venue,v.address,v.format,v.topic,v.kind,v.cover,v.community_id,now).run();
        return response({ id: eid }, 201);
      }
      if (id && action === "bookmark") {
        await detail(id,user);
        if (method === "POST") await db.prepare("INSERT OR IGNORE INTO bookmarks (user_id,event_id) VALUES (?,?)").bind(user.userId,id).run();
        else if (method === "DELETE") await db.prepare("DELETE FROM bookmarks WHERE user_id=? AND event_id=?").bind(user.userId,id).run();
        else throw new FlowError(405, "Метод не поддерживается");
        return response({ ok: true });
      }
      if (!id) throw new FlowError(404, "Мероприятие не найдено");
      await ownedEvent(id,user);
      if (!action && method === "PATCH") {
        const v = eventInput.parse(body);
        await db.prepare(`UPDATE events SET title=?,description=?,starts_at=?,ends_at=?,city=?,venue=?,address=?,format=?,topic=?,kind=?,cover=?,community_id=?,updated_at=? WHERE id=?`)
          .bind(v.title,v.description,v.starts_at,v.ends_at,v.city,v.venue,v.address,v.format,v.topic,v.kind,v.cover,v.community_id,now,id).run();
        return response({ ok: true });
      }
      if (action === "publish" && method === "POST") {
        const count = await db.prepare("SELECT COUNT(*) AS n FROM activities WHERE event_id=?").bind(id).first<{ n: number }>();
        if (!count?.n) throw new FlowError(400, "Перед публикацией добавьте хотя бы одну активность");
        await db.prepare("UPDATE events SET status='published',updated_at=? WHERE id=?").bind(now,id).run();
        return response({ ok: true });
      }
      if (action === "rooms" && method === "POST") {
        const v = roomInput.parse(body), rid=crypto.randomUUID();
        await db.prepare("INSERT INTO rooms (id,event_id,name,capacity) VALUES (?,?,?,?)").bind(rid,id,v.name,v.capacity).run();
        return response({ id: rid },201);
      }
      if (action === "activities" && method === "POST") {
        const v = activityInput.parse(body), aid=crypto.randomUUID();
        await db.prepare("INSERT INTO activities (id,event_id,room_id,title,description,speaker,starts_at,ends_at,capacity,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
          .bind(aid,id,v.room_id,v.title,v.description,v.speaker,v.starts_at,v.ends_at,v.capacity,now).run();
        return response({ id: aid },201);
      }
    }
    if (resource === "rooms" && id && method === "PATCH") {
      const room = await db.prepare("SELECT event_id FROM rooms WHERE id=?").bind(id).first<{ event_id: string }>();
      if (!room) throw new FlowError(404,"Аудитория не найдена");
      await ownedEvent(room.event_id,user);
      const v=roomInput.parse(body);
      await db.prepare("UPDATE rooms SET name=?,capacity=? WHERE id=?").bind(v.name,v.capacity,id).run();
      return response({ ok: true });
    }
    if (resource === "activities" && id) {
      const activity = await db.prepare("SELECT event_id,title FROM activities WHERE id=?").bind(id).first<{event_id:string;title:string}>();
      if (!activity) throw new FlowError(404,"Активность не найдена");
      if (action === "registration") {
        if (method === "POST") await db.prepare("INSERT INTO registrations (user_id,activity_id,created_at) VALUES (?,?,?)").bind(user.userId,id,now).run();
        else if (method === "DELETE") await db.prepare("DELETE FROM registrations WHERE user_id=? AND activity_id=?").bind(user.userId,id).run();
        else throw new FlowError(405,"Метод не поддерживается");
        return response({ ok: true });
      }
      await ownedEvent(activity.event_id,user);
      if (method === "PATCH" && !action) {
        const v=activityInput.parse(body);
        await db.batch([
          db.prepare("UPDATE activities SET room_id=?,title=?,description=?,speaker=?,starts_at=?,ends_at=?,capacity=?,updated_at=? WHERE id=?")
            .bind(v.room_id,v.title,v.description,v.speaker,v.starts_at,v.ends_at,v.capacity,now,id),
          db.prepare(`INSERT INTO notifications (id,user_id,event_id,message,created_at,read)
            SELECT lower(hex(randomblob(16))),user_id,?,?,?,0 FROM registrations WHERE activity_id=?`)
            .bind(activity.event_id,`Обновлена активность «${v.title}». Проверьте время и аудиторию в своём расписании.`,now,id),
          db.prepare("UPDATE events SET updated_at=? WHERE id=?").bind(now,activity.event_id),
        ]);
        return response({ ok: true });
      }
    }
    throw new FlowError(404,"Действие не найдено");
  } catch (error) {
    if (error instanceof FlowError) return response({ error: error.message, code: error.code },error.status);
    if (error instanceof z.ZodError) return response({ error: "Проверьте поля формы: название, даты и вместимость должны быть заполнены корректно", code: "VALIDATION", fields: error.issues.map(i=>i.path.join(".")) },400);
    const message=String(error);
    const code=Object.keys(errorMessages).find(c=>message.includes(c));
    if (code) return response({ error:errorMessages[code],code },409);
    if (message.includes("FOREIGN KEY")) return response({ error:"Связанный объект не найден. Обновите страницу",code:"INVALID_REFERENCE" },400);
    console.error("TFlow API error",error);
    return response({ error:"Не удалось сохранить данные. Повторите попытку",code:"SERVER_ERROR" },500);
  }
}
export const GET=handle;
export const POST=handle;
export const PATCH=handle;
export const DELETE=handle;
