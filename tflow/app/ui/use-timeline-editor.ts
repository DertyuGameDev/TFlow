import {
  useCallback,
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
  moved: boolean;
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
  deferredSave = false,
  onDropActivity,
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
  deferredSave?: boolean;
  onDropActivity?: (activity: Activity, target: Activity, at: number, swap: boolean) => Promise<void>;
}) {
  const gesture = useRef<Gesture | null>(null),
    locked = useRef(false);
  const draggedClick = useRef<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{id:string; at:number; swap:boolean} | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [dragging, setDragging] = useState(false),
    [saving, setSaving] = useState(false);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const resetFeedback = useCallback(() => {
    setError("");
    setNotice("");
  }, []);
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
    draggedClick.current = null;
    e.preventDefault();
    const anchor = timeAt(e.clientX);
    gesture.current = {
      pointerId: e.pointerId,
      x: e.clientX,
      moved: false,
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
    const delta =
      Math.round(
        (((x - current.x) /
          Math.max(1, canvas.current!.getBoundingClientRect().width)) *
          (end - start)) /
          step,
      ) * step;
    if (current.activity && current.edge === "move")
      return moveProgramRange(
        current.activity,
        Math.abs(x - current.x) < 6 ? 0 : delta,
        event.starts_at,
        event.ends_at,
      );
    return current.activity
      ? resizeProgramRange(
          current.activity,
          current.edge === "start" ? "start" : "end",
          (current.edge === "start"
            ? current.activity.starts_at
            : current.activity.ends_at) + delta,
          event.starts_at,
          event.ends_at,
        )
      : createProgramRange(
          current.anchor,
          value,
          start,
          end,
          Math.abs(x - current.x) < 6,
        );
  }
  function release() {
    const current = gesture.current;
    gesture.current = null;
    setDragging(false);
    setDropTarget(null);
    if (current?.target.hasPointerCapture?.(current.pointerId))
      current.target.releasePointerCapture(current.pointerId);
  }
  function cancel() {
    if (!gesture.current) return;
    draggedClick.current = gesture.current.activity?.id ?? null;
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
        deferredSave
          ? `Новое время: ${timeLabel(range.starts_at)}–${timeLabel(range.ends_at)}. Нажмите галочку, чтобы сохранить.`
          : `Время «${activity.title}» сохранено: ${timeLabel(range.starts_at)}–${timeLabel(range.ends_at)}.`,
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
  function targetAt(e: PointerEvent<HTMLElement>, current: Gesture) {
    if(!onDropActivity || current.edge !== "move" || !current.activity || !current.moved)return null;
    const element=document.elementsFromPoint?.(e.clientX,e.clientY).find(el=>{
      const key=el.closest<HTMLElement>("[data-program-item]")?.dataset.programItem;
      return key && key!==current.activity!.id;
    })?.closest<HTMLElement>("[data-program-item]");
    const target=activities.find(a=>a.id===element?.dataset.programItem);
    return target ? {target,at:timeAt(e.clientX),swap:e.shiftKey} : null;
  }
  async function drop(current:Gesture,target:Activity,at:number,swap:boolean){
    if(!onDropActivity||!current.activity||locked.current)return;
    locked.current=true;setSaving(true);setError("");
    try{await onDropActivity(current.activity,target,at,swap);setNotice("Программа сохранена");}
    catch(e){setError((e as Error).message)}finally{locked.current=false;setSaving(false);setPreview(null)}
  }
  const pointerHandlers = {
    onPointerMove(e: PointerEvent<HTMLElement>) {
      const current = gesture.current;
      if (!current || current.pointerId !== e.pointerId) return;
      current.moved ||= Math.abs(e.clientX-current.x)>=(current.edge==="move"?6:1);
      const target=targetAt(e,current);setDropTarget(target?{id:target.target.id,at:target.at,swap:target.swap}:null);
      setPreview({
        activity: current.activity,
        range: rangeAt(current, e.clientX),
      });
    },
    onPointerUp(e: PointerEvent<HTMLElement>) {
      const current = gesture.current;
      if (!current || current.pointerId !== e.pointerId) return;
      const range = rangeAt(current, e.clientX);
      current.moved ||= Math.abs(e.clientX-current.x)>=(current.edge==="move"?6:1);
      const target=targetAt(e,current);
      draggedClick.current = current.activity && current.moved ? current.activity.id : null;
      release();
      if(current.activity&&!current.moved){setPreview(null);return;}
      if(target)void drop(current,target.target,target.at,target.swap);
      else if (current.activity) void save(current.activity, range);
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
    dropTarget,
    resetClickGuard: () => {draggedClick.current=null;},
    shouldIgnoreClick: (_detail: number, activityId: string) => {const ignore=draggedClick.current===activityId;draggedClick.current=null;return ignore;},
    begin,
    cancel,
    createAtStart,
    resizeWithKeyboard,
    moveWithKeyboard,
    pointerHandlers,
    resetFeedback,
  };
}
