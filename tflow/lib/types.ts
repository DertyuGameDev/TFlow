export type Profile = { id: string; name: string; email?: string; city: string; about: string; interests: string };
export type FlowEvent = {
  id: string; owner_id: string; title: string; description: string; starts_at: number; ends_at: number;
  city: string; venue: string; address: string; format: string; topic: string; kind: string; cover: string;
  status: "draft" | "published"; community_id: string | null; updated_at: number; organizer: string;
  saved: number; activity_count: number; participant_count: number;
};
export type Room = { id: string; event_id: string; name: string; capacity: number };
export type Activity = {
  id: string; event_id: string; room_id: string; title: string; description: string; speaker: string;
  starts_at: number; ends_at: number; capacity: number; updated_at: number; room_name: string;
  taken: number; registered: number; event_title?: string; city?: string; venue?: string; event_cover?: string;
};
export type Community = { id: string; name: string; description: string; topic: string; color: string; member_count: number; joined: number };
export type Notice = { id: string; event_id: string; message: string; created_at: number; read: number };
export type Bootstrap = { events: FlowEvent[]; schedule: Activity[]; communities: Community[]; notifications: Notice[]; profile: Profile | null };
export type EventDetail = { event: FlowEvent; rooms: Room[]; activities: Activity[] };
export const TOPICS = ["Искусственный интеллект", "Предпринимательство", "Дизайн", "Разработка", "Карьера", "Наука и образование"];
export const CITIES = ["Москва", "Санкт-Петербург", "Мурманск", "Казань", "Онлайн"];
