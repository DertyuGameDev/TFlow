import { useState } from "react";
import type { Activity, FlowEvent, Room } from "../../lib/types";
import {
  dateLabel,
  fromLocalInput,
  localInput,
  timeLabel,
} from "../../lib/time";
import { FormError, Submit, useSubmit, type Send } from "./forms";

export function ActivityForm({
  event,
  rooms,
  activity,
  initialStart,
  send,
  done,
}: {
  event: FlowEvent;
  rooms: Room[];
  activity?: Activity;
  initialStart?: number;
  send: Send;
  done: () => void;
}) {
  const start = activity?.starts_at ?? initialStart ?? event.starts_at;
  const [startsAt, setStartsAt] = useState(localInput(start));
  const [endsAt, setEndsAt] = useState(
    localInput(activity?.ends_at ?? Math.min(start + 3600000, event.ends_at)),
  );
  const [roomId, setRoomId] = useState(activity?.room_id ?? rooms[0]?.id ?? "@new");
  const [newRoomName, setNewRoomName] = useState(event.format === "Онлайн" ? "Онлайн-комната" : "Основная площадка");
  const [newRoomCapacity, setNewRoomCapacity] = useState(event.capacity);
  const creatingRoom = roomId === "@new";
  const room = rooms.find((item) => item.id === roomId);
  const limit = creatingRoom ? newRoomCapacity : room?.capacity ?? event.capacity;
  const [capacity, setCapacity] = useState(
    activity?.capacity ?? Math.min(event.capacity, limit),
  );
  const { submit, error, busy } = useSubmit(async (data) => {
    const starts_at = fromLocalInput(String(data.get("starts_at")));
    const ends_at = fromLocalInput(String(data.get("ends_at")));
    if (ends_at <= starts_at)
      throw new Error("Окончание должно быть позже начала.");
    await send(
      activity ? `activities/${activity.id}` : `events/${event.id}/activities`,
      activity ? "PATCH" : "POST",
      {
        title: data.get("title"),
        description: data.get("description"),
        speaker: data.get("speaker"),
        room_id: creatingRoom ? "" : roomId,
        ...(creatingRoom ? {new_room_name: newRoomName, new_room_capacity: newRoomCapacity} : {}),
        starts_at,
        ends_at,
        capacity,
      },
    );
    done();
  });
  function changeStart(value: string) {
    const delta = fromLocalInput(value) - fromLocalInput(startsAt);
    setStartsAt(value);
    if (Number.isFinite(delta))
      setEndsAt((current) => {
        const end = fromLocalInput(current);
        return Number.isFinite(end)
          ? localInput(Math.min(end + delta, event.ends_at))
          : current;
      });
  }
  return (
    <form className="flow-form" onSubmit={submit}>
      <label>
        Название пункта программы
        <input
          name="title"
          required
          defaultValue={activity?.title}
          placeholder="Например, Открытие или Лекция о дизайне"
        />
      </label>
      <div className="form-row">
        <label>
          Начало · МСК
          <input
            name="starts_at"
            type="datetime-local"
            required
            min={localInput(event.starts_at)}
            max={localInput(event.ends_at)}
            value={startsAt}
            onChange={(e) => changeStart(e.target.value)}
          />
        </label>
        <label>
          Окончание · МСК
          <input
            name="ends_at"
            type="datetime-local"
            required
            min={startsAt}
            max={localInput(event.ends_at)}
            value={endsAt}
            onChange={(e) => setEndsAt(e.target.value)}
          />
        </label>
      </div>
      <p className="muted small">
        В пределах мероприятия: {dateLabel(event.starts_at)}{" "}
        {timeLabel(event.starts_at)} — {dateLabel(event.ends_at)}{" "}
        {timeLabel(event.ends_at)} МСК.
      </p>
      {rooms.length > 0 && (
        <label>
          Аудитория
          <select
            name="room_id"
            required
            value={roomId}
            onChange={(e) => {
              setRoomId(e.target.value);
              const next = rooms.find((item) => item.id === e.target.value);
              setCapacity((current) => Math.min(current, next?.capacity ?? newRoomCapacity));
            }}
          >
            {rooms.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · {item.capacity} мест
              </option>
            ))}
            <option value="@new">Создать новую аудиторию</option>
          </select>
        </label>
      )}
      {creatingRoom && <fieldset className="program-new-room">
        <legend>Новая аудитория</legend>
        <p className="event-field-hint">Сохраним аудиторию вместе с пунктом программы.</p>
        <div className="form-row">
          <label>Название аудитории<input name="new_room_name" required value={newRoomName} onChange={e=>setNewRoomName(e.target.value)} /></label>
          <label>Вместимость аудитории<input name="new_room_capacity" type="number" required min={1} value={newRoomCapacity}
            onChange={e=>{const value=Number(e.target.value);setNewRoomCapacity(value);setCapacity(current=>Math.min(current,value));}} /></label>
        </div>
      </fieldset>}
      <div className="form-row">
        <label>
          Спикер · необязательно
          <input
            name="speaker"
            defaultValue={activity?.speaker}
            placeholder="Имя и фамилия"
          />
        </label>
        <label>
          Лимит мест
          <input
            name="capacity"
            type="number"
            required
            min={1}
            max={limit}
            value={capacity}
            onChange={(e) => setCapacity(Number(e.target.value))}
          />
        </label>
      </div>
      <label>
        Описание · необязательно
        <textarea
          name="description"
          rows={2}
          defaultValue={activity?.description}
          placeholder="Что будет происходить на этом этапе?"
        />
      </label>
      <p className="muted small">
        Проверим пересечения по аудитории и записи участников перед сохранением.
      </p>
      <FormError error={error} />
      <div className="form-footer">
        <Submit
          busy={busy}
          label={
            activity ? "Сохранить пункт программы" : "Добавить в программу"
          }
        />
      </div>
    </form>
  );
}
