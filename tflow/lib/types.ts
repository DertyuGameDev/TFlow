import categoryGroups from "../backend/flow/interest_categories.json";
import { CITY_SUGGESTIONS } from "./cities";

export type UserIdentity = { userId: string; displayName: string; email: string; fullName: string | null; role: "participant" | "organizer" };
export type ParticipantData = { name: string; email: string; phone: string; birth_date: string; city: string; telegram: string; organization: string; job_title: string; education: string; website: string; about: string; interests: string };
export type RequiredProfileField = Exclude<keyof ParticipantData, "name" | "email">;
export type Profile = ParticipantData & { id: string; first_name: string; last_name: string; avatar_url: string | null; role: "participant" | "organizer"; pass_token: string };

export type FlowEvent = {
  id: string; owner_id: string; title: string; description: string; starts_at: number; ends_at: number;
  city: string; venue: string; address: string; format: string; topic: string; kind: string; cover: string;
  status: "draft" | "published"; community_id: string | null; updated_at: number; organizer: string;
  saved: number; activity_count: number; participant_count: number;
  capacity: number; checked_in_count: number; enrolled: number; checked_in: number;
  required_profile_fields: RequiredProfileField[];
};
export type Room = { id: string; event_id: string; name: string; capacity: number; is_online?: boolean };
export type Activity = {
  id: string; event_id: string; room_id: string; title: string; description: string; speaker: string;
  starts_at: number; ends_at: number; capacity: number; updated_at: number; room_name: string;
  taken: number; registered: number; waiting_count: number; waitlisted: number; waitlist_position: number;
  room_is_online?: boolean;
  event_title?: string; city?: string; venue?: string; event_cover?: string;
};
export type Community = { id: string; name: string; description: string; topic: string; color: string; member_count: number; joined: number; owner_id: string | null; event_count: number; avatar_url: string | null };
export type Notice = { id: string; event_id: string | null; kind: "info" | "event_cancelled"; message: string; created_at: number; read: number };
export type NoticePage = { items: Notice[]; next_cursor: string | null };
export type Bootstrap = { events: FlowEvent[]; tickets: FlowEvent[]; schedule: Activity[]; waitlist: Activity[]; communities: Community[]; notifications: Notice[]; unread_notification_count: number; profile: Profile | null };
export type EventDetail = { event: FlowEvent; rooms: Room[]; activities: Activity[] };
export type Attendee = ParticipantData & { id: string; profile_data: ParticipantData; activities: string[] };
export type AttendanceRow = { id: string; name: string; email: string; city: string; profile_data: ParticipantData; created_at: number; checked_in_at: number | null };
export type ScanResult = { admitted: boolean; already_checked_in: boolean; checked_in_at: number; attendee: Attendee };
export const CATEGORY_GROUPS = categoryGroups;
export const TOPICS = CATEGORY_GROUPS.flatMap(group => group.categories);
export const CITIES = [...CITY_SUGGESTIONS, "Онлайн"];
