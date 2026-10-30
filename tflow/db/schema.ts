import { sqliteTable, text, integer, primaryKey, index } from "drizzle-orm/sqlite-core";

export const profiles = sqliteTable("profiles", {
  id: text("id").primaryKey(), name: text("name").notNull(), email: text("email").notNull(),
  city: text("city").notNull().default("Москва"), about: text("about").notNull().default(""),
  interests: text("interests").notNull().default(""),
});
export const communities = sqliteTable("communities", {
  id: text("id").primaryKey(), name: text("name").notNull(), description: text("description").notNull(),
  topic: text("topic").notNull(), color: text("color").notNull(),
});
export const events = sqliteTable("events", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull().references(() => profiles.id),
  title: text("title").notNull(), description: text("description").notNull(),
  startsAt: integer("starts_at").notNull(), endsAt: integer("ends_at").notNull(),
  city: text("city").notNull(), venue: text("venue").notNull(), address: text("address").notNull().default(""),
  format: text("format").notNull().default("Очно"), topic: text("topic").notNull(),
  kind: text("kind").notNull().default("Конференция"), cover: text("cover").notNull().default("yellow"),
  status: text("status").notNull().default("draft"), communityId: text("community_id").references(() => communities.id),
  updatedAt: integer("updated_at").notNull(),
}, table => [index("events_owner").on(table.ownerId), index("events_start").on(table.startsAt)]);
export const rooms = sqliteTable("rooms", {
  id: text("id").primaryKey(), eventId: text("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  name: text("name").notNull(), capacity: integer("capacity").notNull(),
});
export const activities = sqliteTable("activities", {
  id: text("id").primaryKey(), eventId: text("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  roomId: text("room_id").notNull().references(() => rooms.id), title: text("title").notNull(),
  description: text("description").notNull(), speaker: text("speaker").notNull().default(""),
  startsAt: integer("starts_at").notNull(), endsAt: integer("ends_at").notNull(), capacity: integer("capacity").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, table => [index("activities_room_time").on(table.roomId, table.startsAt, table.endsAt)]);
export const registrations = sqliteTable("registrations", {
  userId: text("user_id").notNull().references(() => profiles.id),
  activityId: text("activity_id").notNull().references(() => activities.id, { onDelete: "cascade" }),
  createdAt: integer("created_at").notNull(),
}, table => [primaryKey({ columns: [table.userId, table.activityId] }), index("registration_activity").on(table.activityId)]);
export const bookmarks = sqliteTable("bookmarks", {
  userId: text("user_id").notNull().references(() => profiles.id),
  eventId: text("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
}, table => [primaryKey({ columns: [table.userId, table.eventId] })]);
export const memberships = sqliteTable("memberships", {
  userId: text("user_id").notNull().references(() => profiles.id),
  communityId: text("community_id").notNull().references(() => communities.id),
}, table => [primaryKey({ columns: [table.userId, table.communityId] })]);
export const notifications = sqliteTable("notifications", {
  id: text("id").primaryKey(), userId: text("user_id").notNull().references(() => profiles.id),
  eventId: text("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  message: text("message").notNull(), createdAt: integer("created_at").notNull(), read: integer("read").notNull().default(0),
}, table => [index("notifications_user").on(table.userId)]);
