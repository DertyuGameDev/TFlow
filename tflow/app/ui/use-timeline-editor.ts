import {
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from "react";
import type { Activity, FlowEvent } from "../../lib/types";
import {
  createProgramRange,
  moveProgramRange,
  PROGRAM_MINUTE,
  programRangeConflict,
  resizeProgramRange,
  timelineTimeAt,
  type ProgramEdge,
  type ProgramRange,
} from "../../lib/program-editing";
import { timeLabel } from "../../lib/time";

type Preview = { activity?: Activity; range: ProgramRange };
type Gesture = {
  pointerId: number;
  x: number;
  anchor: number;
  activity?: Activity;
  edge?: ProgramEdge | "move";
  target: HTMLElement;
};

export function useTimelineEditor({
  event,
  activities,
  start,
  end,
  step,
  roomId,
  canvas,
  onCreate,
  onReschedule,
}: {
  event: FlowEvent;
  activities: Activity[];
  start: number;
  end: number;
  step: number;
  roomId?: string;
  canvas: RefObject<HTMLDivElement | null>;
  onCreate?: (range: ProgramRange) => void;
  onReschedule?: (activity: Activity, range: ProgramRange) => Promise<void>;
}) {
  const gesture = useRef<Gesture | null>(null),
    locked = useRef(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [dragging, setDragging] = useState(false),
    [saving, setSaving] = useState(false);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  function timeAt(x: number) {
    const bounds = canvas.current!.getBoundingClientRect();
    return timelineTimeAt(x, bounds.left, bounds.width, start, end, step);
  }
  function begin(
    e: PointerEvent<HTMLElement>,
    activity?: Activity,
    edge?: ProgramEdge | "move",
  ) {
    if (
      e.button !== 0 ||
      e.isPrimary === false ||
      locked.current ||
      gesture.current ||
      !canvas.current
    )
      return;
    if (activity ? !onReschedule : !onCreate) return;
    e.preventDefault();
    const anchor = timeAt(e.clientX);
    gesture.current = {
      pointerId: e.pointerId,
      x: e.clientX,
      anchor,
      activity,
      edge,
      target: e.currentTarget,
    };
    e.currentTarget.focus({ preventScroll: true });
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setError("");
    setNotice("");
    setDragging(true);
    setPreview({
      activity,
      range: activity
        ? { starts_at: activity.starts_at, ends_at: activity.ends_at }
        : createProgramRange(anchor, anchor, start, end, true),
    });
  }
  function rangeAt(current: Gesture, x: number) {
    const value = timeAt(x);
    if (current.activity && current.edge === "move")
      return moveProgramRange(current.activity, Math.abs(x - current.x) < 4 ? 0 : value - current.anchor, event.starts_at, event.ends_at);
    return current.activity
      ? resizeProgramRange(
          current.activity,
          current.edge === "start" ? "start" : "end",
          (current.edge === "start"
            ? current.activity.starts_at
            : current.activity.ends_at) +
            value -
            current.anchor,
          event.starts_at,
          event.ends_at,
        )
      : createProgramRange(
          current.anchor,
          value,
          start,
          end,
          Math.abs(x - current.x) < 4,
        );
  }
  function release() {
    const current = gesture.current;
    gesture.current = null;
    setDragging(false);
    if (current?.target.hasPointerCapture?.(current.pointerId))
      current.target.releasePointerCapture(current.pointerId);
  }
  function cancel() {
    if (!gesture.current) return;
    release();
    setPreview(null);
    setNotice("Изменение отменено.");
  }
  async function save(activity: Activity, range: ProgramRange) {
    if (!onReschedule || locked.current) return;
    if (
      range.starts_at === activity.starts_at &&
      range.ends_at === activity.ends_at
    ) {
      setPreview(null);
      return;
    }
    const conflict = programRangeConflict(activity, range, activities);
    if (conflict) {
      setError(
        `В этой аудитории уже запланирован пункт «${conflict.title}». Выберите другое время.`,
      );
      setPreview(null);
      return;
    }
    locked.current = true;
    setSaving(true);
    setError("");
    setNotice("");
    setPreview({ activity, range });
    try {
      await onReschedule(activity, range);
      setNotice(
        `Время «${activity.title}» сохранено: ${timeLabel(range.starts_at)}–${timeLabel(range.ends_at)}.`,
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Не удалось изменить время. Повторите попытку.",
      );
    } finally {
      locked.current = false;
      setSaving(false);
      setPreview(null);
    }
  }
  function createAtStart() {
    if (!locked.current)
      onCreate?.({
        ...createProgramRange(start, start, start, end, true),
        room_id: roomId,
      });
  }
  function resizeWithKeyboard(
    e: KeyboardEvent<HTMLElement>,
    activity: Activity,
    edge: ProgramEdge,
  ) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    if (gesture.current || locked.current || e.repeat) return;
    const current = edge === "start" ? activity.starts_at : activity.ends_at;
    const value =
      e.key === "Home"
        ? start
        : e.key === "End"
          ? end
          : current +
            (e.key === "ArrowLeft" ? -1 : 1) *
              (e.shiftKey ? 15 * PROGRAM_MINUTE : step);
    void save(
      activity,
      resizeProgramRange(activity, edge, value, event.starts_at, event.ends_at),
    );
  }
  function moveWithKeyboard(e: KeyboardEvent<HTMLElement>, activity: Activity) {
    if (!e.altKey || !["ArrowLeft", "ArrowRight"].includes(e.key)) return;
    e.preventDefault();
    if (gesture.current || locked.current || e.repeat) return;
    void save(activity, moveProgramRange(activity,
      (e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 15 * PROGRAM_MINUTE : step),
      event.starts_at, event.ends_at));
  }
  const pointerHandlers = {
    onPointerMove(e: PointerEvent<HTMLElement>) {
      const current = gesture.current;
      if (!current || current.pointerId !== e.pointerId) return;
      setPreview({
        activity: current.activity,
        range: rangeAt(current, e.clientX),
      });
    },
    onPointerUp(e: PointerEvent<HTMLElement>) {
      const current = gesture.current;
      if (!current || current.pointerId !== e.pointerId) return;
      const range = rangeAt(current, e.clientX);
      release();
      if (current.activity) void save(current.activity, range);
      else {
        setPreview(null);
        onCreate?.({ ...range, room_id: roomId });
      }
    },
    onPointerCancel(e: PointerEvent<HTMLElement>) {
      if (gesture.current?.pointerId === e.pointerId) cancel();
    },
    onLostPointerCapture(e: PointerEvent<HTMLElement>) {
      if (gesture.current?.pointerId === e.pointerId) cancel();
    },
  };
  return {
    preview,
    dragging,
    saving,
    error,
    notice,
    begin,
    cancel,
    createAtStart,
    resizeWithKeyboard,
    moveWithKeyboard,
    pointerHandlers,
  };
}
