export type UserIdentity = { userId: string; displayName: string; email: string; fullName: string | null; role: "participant" | "organizer" };
export type Profile = { id: string; name: string; email?: string; city: string; about: string; interests: string; role: "participant" | "organizer"; pass_token: string };
export type FlowEvent = {
  id: string; owner_id: string; title: string; description: string; starts_at: number; ends_at: number;
  city: string; venue: string; address: string; format: string; topic: string; kind: string; cover: string;
  status: "draft" | "published"; community_id: string | null; updated_at: number; organizer: string;
  saved: number; activity_count: number; participant_count: number;
  capacity: number; checked_in_count: number; enrolled: number; checked_in: number;
};
export type Room = { id: string; event_id: string; name: string; capacity: number };
export type Activity = {
  id: string; event_id: string; room_id: string; title: string; description: string; speaker: string;
  starts_at: number; ends_at: number; capacity: number; updated_at: number; room_name: string;
  taken: number; registered: number; event_title?: string; city?: string; venue?: string; event_cover?: string;
};
export type Community = { id: string; name: string; description: string; topic: string; color: string; member_count: number; joined: number };
export type Notice = { id: string; event_id: string; message: string; created_at: number; read: number };
export type Bootstrap = { events: FlowEvent[]; tickets: FlowEvent[]; schedule: Activity[]; communities: Community[]; notifications: Notice[]; profile: Profile | null };
export type EventDetail = { event: FlowEvent; rooms: Room[]; activities: Activity[] };
export type Attendee = { id: string; name: string; email: string; city: string; about: string; interests: string; activities: string[] };
export type AttendanceRow = { id: string; name: string; email: string; city: string; created_at: number; checked_in_at: number | null };
export type ScanResult = { admitted: boolean; already_checked_in: boolean; checked_in_at: number; attendee: Attendee };
export const TOPICS = ["Искусственный интеллект", "Предпринимательство", "Дизайн", "Разработка", "Карьера", "Наука и образование"];
export const CITIES = ["Москва", "Санкт-Петербург", "Мурманск", "Казань", "Онлайн"];
