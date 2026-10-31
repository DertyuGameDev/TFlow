import { useEffect, useRef, useState } from "react";
import { Check, Settings2, X } from "lucide-react";
import type { Activity, FlowEvent, Room } from "../../lib/types";
import { dateKey, dateLabel, fromLocalInput, localInput } from "../../lib/time";
import type { ProgramRange } from "../../lib/program-editing";
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
}) {
  const multiDay = dateKey(event.starts_at) !== dateKey(event.ends_at - 1);
  const format = (value: number) =>
    multiDay ? localInput(value) : localInput(value).slice(11);
  const [title, setTitle] = useState(activity?.title ?? "");
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
          ...next,
          room_id: roomId,
          online_room: room
            ? Boolean(room.is_online)
            : event.format === "Онлайн",
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
        {rooms.length > 1 ? (
          <select
            aria-label="Аудитория пункта на графике"
            value={roomId}
            disabled={busy}
            onChange={(e) => {
              setRoomId(e.target.value);
              preview(start, end, e.target.value);
            }}
          >
            {rooms.map((room) => (
              <option key={room.id} value={room.id}>
                {room.name}
              </option>
            ))}
          </select>
        ) : (
          <span>
            {rooms[0]?.name ??
              (event.format === "Онлайн" ? "Онлайн" : "Основная площадка")}
          </span>
        )}
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
      {busy && (
        <span className="program-graph-saving" role="status">
          Сохраняем…
        </span>
      )}
      <FormError error={error} />
    </form>
  );
}
