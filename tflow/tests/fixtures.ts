import type { FlowEvent, Profile, Notice } from "../lib/types";

export const event: FlowEvent = {
  id: "event-one", owner_id: "host-one", title: "Открытая лекция", description: "Подробное описание открытой лекции",
  starts_at: Date.parse("2026-11-12T10:00:00+03:00"), ends_at: Date.parse("2026-11-12T12:00:00+03:00"),
  city: "Москва", venue: "Библиотека", address: "Улица Лесная, 5", format: "Очно", topic: "Разработка", kind: "Лекция",
  cover: "yellow", status: "published", community_id: null, organizer: "Организатор", activity_count: 0,
  saved: 0, participant_count: 4, capacity: 100, checked_in_count: 0, enrolled: 0, checked_in: 0,
  updated_at: 1, required_profile_fields: [],
  event_waitlisted: 0, event_waitlist_position: 0, event_waiting_count: 0,
};
export const profile: Profile = {
  id: "person-one", name: "Анна Петрова", first_name: "Анна", last_name: "Петрова", email: "anna@example.test",
  city: "Москва", role: "participant", avatar_url: null, pass_token: "test-pass", phone: "", birth_date: "",
  telegram: "", organization: "", job_title: "", education: "", website: "", about: "", interests: "",
};
export function notice(id: string, extra: Partial<Notice> = {}): Notice {
  return { id, event_id: event.id, kind: "info", message: `Сообщение ${id}`, created_at: event.starts_at, read: 0, ...extra };
}
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}
