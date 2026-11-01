import { useEffect, useRef, useState } from "react";
import { ArrowLeftRight, Check, Settings2, X } from "lucide-react";
import type { Activity, FlowEvent, Room } from "../../lib/types";
import { dateKey, dateLabel, fromLocalInput, localInput } from "../../lib/time";
import { NEW_ONLINE_ROOM, type ProgramRange } from "../../lib/program-editing";
import { FormError, type Send } from "./forms";
import "../program-graph-editor.css";

export function ProgramGraphEditor({
  event,
  rooms,
  activity,
  range,
  send,
  refresh,
  onPreview,
  onDone,
  onCancel,
  onDetails,
  onSwap,
}: {
  event: FlowEvent;
  rooms: Room[];
  activity?: Activity;
  range: ProgramRange;
  send: Send;
  refresh: () => Promise<void>;
  onPreview: (range: ProgramRange) => void;
  onDone: (id: string) => void;
  onCancel: () => void;
  onDetails?: () => void;
  onSwap?: () => void;
}) {
  const multiDay = dateKey(event.starts_at) !== dateKey(event.ends_at - 1);
  const format = (value: number) =>
    multiDay ? localInput(value) : localInput(value).slice(11);
  const [title, setTitle] = useState(activity?.title ?? "");
  const [registrationRequired, setRegistrationRequired] = useState(activity?.registration_required !== false);
  const savedRegistrationRequired = activity?.registration_required;
  useEffect(() => { setRegistrationRequired(savedRegistrationRequired !== false); }, [savedRegistrationRequired]);
  const [start, setStart] = useState(format(range.starts_at)),
    [end, setEnd] = useState(format(range.ends_at));
  const [roomId, setRoomId] = useState(
    activity?.room_id ??
      range.room_id ??
      (event.format === "Онлайн"
        ? rooms.find((room) => room.is_online)?.id
        : rooms.find((room) => !room.is_online)?.id) ??
      rooms[0]?.id ??
      "",
  );
  const creatingOnlineRoom = roomId === NEW_ONLINE_ROOM;
  const [onlineRoomName, setOnlineRoomName] = useState(
    `Онлайн-поток ${rooms.filter((room) => room.is_online).length + 1}`,
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const locked = useRef(false),
    form = useRef<HTMLFormElement>(null);
  const savedRoomId = activity?.room_id;
  useEffect(() => {
    if (savedRoomId) setRoomId(savedRoomId);
  }, [savedRoomId]);
  useEffect(() => {
    setStart(
      multiDay
        ? localInput(range.starts_at)
        : localInput(range.starts_at).slice(11),
    );
    setEnd(
      multiDay
        ? localInput(range.ends_at)
        : localInput(range.ends_at).slice(11),
    );
  }, [range.starts_at, range.ends_at, multiDay]);
  useEffect(() => {
    form.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
    form.current
      ?.querySelector<HTMLInputElement>('input[name="title"]')
      ?.focus({ preventScroll: true });
  }, []);
  function values(from = start, to = end): ProgramRange {
    return {
      starts_at: fromLocalInput(
        multiDay ? from : `${dateKey(range.starts_at)}T${from}`,
      ),
      ends_at: fromLocalInput(
        multiDay ? to : `${dateKey(range.ends_at)}T${to}`,
      ),
      room_id: roomId,
    };
  }
  function preview(from: string, to: string, room = roomId) {
    const next = values(from, to);
    if (
      Number.isFinite(next.starts_at) &&
      Number.isFinite(next.ends_at) &&
      next.starts_at < next.ends_at &&
      next.starts_at >= event.starts_at &&
      next.ends_at <= event.ends_at
    )
      onPreview({ ...next, room_id: room });
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (locked.current) return;
    const next = values(),
      name = title.trim(),
      room = rooms.find((room) => room.id === roomId);
    if (!name) {
      setError("Впишите название.");
      return;
    }
    if (
      !Number.isFinite(next.starts_at) ||
      !Number.isFinite(next.ends_at) ||
      next.ends_at <= next.starts_at
    ) {
      setError("Окончание должно быть позже начала.");
      return;
    }
    if (next.starts_at < event.starts_at || next.ends_at > event.ends_at) {
      setError("Выберите время в пределах мероприятия.");
      return;
    }
    if (creatingOnlineRoom && !onlineRoomName.trim()) {
      setError("Впишите название онлайн-потока.");
      return;
    }
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      const result = (await send(
        activity
          ? `activities/${activity.id}`
          : `events/${event.id}/activities`,
        activity ? "PATCH" : "POST",
        {
          title: name,
          registration_required: registrationRequired,
          ...next,
          room_id: creatingOnlineRoom ? "" : roomId,
          ...(creatingOnlineRoom ? {
            new_room_name: onlineRoomName.trim(),
            new_room_capacity: event.capacity,
          } : {}),
          online_room: creatingOnlineRoom || (room
            ? Boolean(room.is_online)
            : event.format === "Онлайн"),
          capacity: Math.min(
            activity?.capacity ?? event.capacity,
            room?.capacity ?? event.capacity,
          ),
          description: activity?.description ?? "",
          speaker: activity?.speaker ?? "",
          ...(activity ? { expected_updated_at: activity.updated_at } : {}),
        },
      )) as { id: string };
      await refresh();
      onDone(activity?.id ?? result.id);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Не удалось сохранить. Повторите попытку.",
      );
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  return (
    <form
      ref={form}
      className="program-graph-editor"
      aria-label="Пункт на графике"
      onSubmit={(e) => void save(e)}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !busy) {
          e.preventDefault();
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      <input
        name="title"
        aria-label="Название пункта на графике"
        placeholder="Название"
        required
        value={title}
        disabled={busy}
        onChange={(e) => setTitle(e.target.value)}
      />
      <div className={`program-graph-time ${multiDay ? "is-multiday" : ""}`}>
        <input
          aria-label="Начало пункта на графике"
          title={dateLabel(range.starts_at)}
          type={multiDay ? "datetime-local" : "time"}
          step={60}
          required
          value={start}
          disabled={busy}
          onChange={(e) => {
            setStart(e.target.value);
            preview(e.target.value, end);
          }}
        />
        <span aria-hidden="true">–</span>
        <input
          aria-label="Окончание пункта на графике"
          title={dateLabel(range.ends_at)}
          type={multiDay ? "datetime-local" : "time"}
          step={60}
          required
          value={end}
          disabled={busy}
          onChange={(e) => {
            setEnd(e.target.value);
            preview(start, e.target.value);
          }}
        />
        <button
          type="submit"
          className="icon-button program-graph-save"
          aria-label="Сохранить пункт на графике"
          disabled={busy}
          title="Сохранить · Enter"
        >
          <Check size={18} />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Отменить правку на графике"
          disabled={busy}
          onClick={onCancel}
        >
          <X size={17} />
        </button>
      </div>
      <div className="program-graph-room">
        <select
          aria-label="Аудитория пункта на графике"
          value={roomId}
          disabled={busy}
          onChange={(e) => {
            setRoomId(e.target.value);
            preview(start, end, e.target.value);
          }}
        >
          {!rooms.length && <option value="">{event.format === "Онлайн" ? "Онлайн" : "Основная площадка"}</option>}
          {rooms.map((room) => (
            <option key={room.id} value={room.id}>
              {room.is_online ? "Онлайн · " : "Очно · "}{room.name}
            </option>
          ))}
          <option value={NEW_ONLINE_ROOM}>Создать онлайн-поток</option>
        </select>
        {onDetails && (
          <button
            type="button"
            className="icon-button"
            aria-label="Другие параметры пункта"
            title="Спикер, места и описание"
            disabled={busy}
            onClick={onDetails}
          >
            <Settings2 size={17} />
          </button>
        )}
      </div>
      {creatingOnlineRoom && <label className="program-graph-online-name">
        Название онлайн-потока
        <input value={onlineRoomName} required disabled={busy} onChange={(event) => setOnlineRoomName(event.target.value)} />
      </label>}
      {creatingOnlineRoom && <small className="muted">Создадим отдельную онлайн-аудиторию и вебинар для этого флоу.</small>}
      <label className="program-graph-registration">
        <input type="checkbox" checked={registrationRequired} disabled={busy} onChange={(event) => setRegistrationRequired(event.target.checked)} />
        Нужна отдельная запись
      </label>
      {!registrationRequired && <small className="muted">Доступна всем участникам мероприятия. Добавление в расписание не бронирует место.</small>}
      {onSwap && <button type="button" className="text-button program-graph-swap" disabled={busy} onClick={onSwap}>
        <ArrowLeftRight size={16} /> Поменять местами
      </button>}
      {busy && (
        <span className="program-graph-saving" role="status">
          Сохраняем…
        </span>
      )}
      {creatingOnlineRoom && <label className="program-graph-online-name">
        Название онлайн-потока
        <input value={onlineRoomName} required disabled={busy} onChange={event => setOnlineRoomName(event.target.value)} />
      </label>}
      {creatingOnlineRoom && <small className="muted">Создадим отдельную онлайн-аудиторию и вебинар для этого флоу.</small>}
      <FormError error={error} />
    </form>
  );
}
