-- D1 serializes writes. Checks in the same INSERT/UPDATE statement cannot race.
CREATE TRIGGER registration_guard BEFORE INSERT ON registrations BEGIN
  SELECT RAISE(ABORT, 'ALREADY_REGISTERED') WHERE EXISTS (
    SELECT 1 FROM registrations WHERE user_id=NEW.user_id AND activity_id=NEW.activity_id
  );
  SELECT RAISE(ABORT, 'NOT_PUBLISHED') WHERE NOT EXISTS (
    SELECT 1 FROM activities a JOIN events e ON e.id=a.event_id
    WHERE a.id=NEW.activity_id AND e.status='published'
  );
  SELECT RAISE(ABORT, 'REGISTRATION_CLOSED') WHERE EXISTS (
    SELECT 1 FROM activities WHERE id=NEW.activity_id AND starts_at <= unixepoch('now')*1000
  );
  SELECT RAISE(ABORT, 'NO_SEATS') WHERE (
    SELECT COUNT(*) FROM registrations WHERE activity_id=NEW.activity_id
  ) >= (SELECT capacity FROM activities WHERE id=NEW.activity_id);
  SELECT RAISE(ABORT, 'PARTICIPANT_CONFLICT') WHERE EXISTS (
    SELECT 1 FROM registrations r JOIN activities a ON a.id=r.activity_id
    JOIN activities target ON target.id=NEW.activity_id
    WHERE r.user_id=NEW.user_id AND a.starts_at < target.ends_at AND a.ends_at > target.starts_at
  );
END;
--> statement-breakpoint
CREATE TRIGGER activity_insert_guard BEFORE INSERT ON activities BEGIN
  SELECT RAISE(ABORT, 'INVALID_TIME') WHERE NEW.starts_at >= NEW.ends_at;
  SELECT RAISE(ABORT, 'INVALID_CAPACITY') WHERE NEW.capacity < 1 OR NEW.capacity > 10000;
  SELECT RAISE(ABORT, 'ROOM_CAPACITY') WHERE NOT EXISTS (
    SELECT 1 FROM rooms WHERE id=NEW.room_id AND event_id=NEW.event_id AND capacity>=NEW.capacity
  );
  SELECT RAISE(ABORT, 'EVENT_DATES') WHERE NOT EXISTS (
    SELECT 1 FROM events WHERE id=NEW.event_id AND starts_at<=NEW.starts_at AND ends_at>=NEW.ends_at
  );
  SELECT RAISE(ABORT, 'ROOM_CONFLICT') WHERE EXISTS (
    SELECT 1 FROM activities WHERE id<>NEW.id AND room_id=NEW.room_id AND starts_at<NEW.ends_at AND ends_at>NEW.starts_at
  );
END;
--> statement-breakpoint
CREATE TRIGGER activity_update_guard BEFORE UPDATE ON activities BEGIN
  SELECT RAISE(ABORT, 'INVALID_TIME') WHERE NEW.starts_at >= NEW.ends_at;
  SELECT RAISE(ABORT, 'INVALID_CAPACITY') WHERE NEW.capacity < 1 OR NEW.capacity > 10000;
  SELECT RAISE(ABORT, 'ROOM_CAPACITY') WHERE NOT EXISTS (
    SELECT 1 FROM rooms WHERE id=NEW.room_id AND event_id=NEW.event_id AND capacity>=NEW.capacity
  );
  SELECT RAISE(ABORT, 'EVENT_DATES') WHERE NOT EXISTS (
    SELECT 1 FROM events WHERE id=NEW.event_id AND starts_at<=NEW.starts_at AND ends_at>=NEW.ends_at
  );
  SELECT RAISE(ABORT, 'ROOM_CONFLICT') WHERE EXISTS (
    SELECT 1 FROM activities WHERE id<>NEW.id AND room_id=NEW.room_id AND starts_at<NEW.ends_at AND ends_at>NEW.starts_at
  );
  SELECT RAISE(ABORT, 'BELOW_REGISTERED') WHERE NEW.capacity < (
    SELECT COUNT(*) FROM registrations WHERE activity_id=NEW.id
  );
  SELECT RAISE(ABORT, 'ENROLLED_CONFLICT') WHERE EXISTS (
    SELECT 1 FROM registrations own JOIN registrations other ON other.user_id=own.user_id
    JOIN activities a ON a.id=other.activity_id
    WHERE own.activity_id=NEW.id AND other.activity_id<>NEW.id
      AND a.starts_at<NEW.ends_at AND a.ends_at>NEW.starts_at
  );
END;
--> statement-breakpoint
CREATE TRIGGER room_insert_guard BEFORE INSERT ON rooms BEGIN
  SELECT RAISE(ABORT, 'INVALID_CAPACITY') WHERE NEW.capacity<1 OR NEW.capacity>10000;
END;
--> statement-breakpoint
CREATE TRIGGER room_update_guard BEFORE UPDATE ON rooms BEGIN
  SELECT RAISE(ABORT, 'INVALID_CAPACITY') WHERE NEW.capacity<1 OR NEW.capacity>10000;
  SELECT RAISE(ABORT, 'ROOM_CAPACITY') WHERE EXISTS (
    SELECT 1 FROM activities WHERE room_id=NEW.id AND capacity>NEW.capacity
  );
END;
--> statement-breakpoint
CREATE TRIGGER event_insert_guard BEFORE INSERT ON events BEGIN
  SELECT RAISE(ABORT, 'INVALID_TIME') WHERE NEW.starts_at>=NEW.ends_at;
END;
--> statement-breakpoint
CREATE TRIGGER event_update_guard BEFORE UPDATE ON events BEGIN
  SELECT RAISE(ABORT, 'INVALID_TIME') WHERE NEW.starts_at>=NEW.ends_at;
  SELECT RAISE(ABORT, 'EVENT_DATES') WHERE EXISTS (
    SELECT 1 FROM activities WHERE event_id=NEW.id AND (starts_at<NEW.starts_at OR ends_at>NEW.ends_at)
  );
END;
