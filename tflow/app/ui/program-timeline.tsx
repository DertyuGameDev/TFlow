import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  ChevronLeft,
  ChevronRight,
  Layers,
  List,
  Minus,
  Pencil,
  Plus,
  Search,
  ArrowLeftRight,
  Undo2,
} from "lucide-react";
import type { Activity, FlowEvent, Room } from "../../lib/types";
import { PROGRAM_MINUTE, type ProgramRange } from "../../lib/program-editing";
import type { MontageAction, MontageResult } from "../../lib/program-montage";
import { useProgramMontage } from "./use-program-montage";
import { TimelineMenu, type TimelineMenuItem } from "./timeline-menu";
import { useTimelineEditor } from "./use-timeline-editor";
import { FormError } from "./forms";
import { dateKey, dateLabel, timeLabel } from "../../lib/time";
import {
  buildProgramTracks,
  PROGRAM_COLORS,
  itemsInRange,
  programColorMap,
  programDayBounds,
  programDayRange,
  programTimeTicks,
  projectProgramTracks,
  segmentBackground,
  shiftProgramDay,
  type TimelineSegment,
} from "../../lib/program-timeline";
import "../program-timeline.css";

const PAGE_SIZE = 8;
const MAX_ZOOM = 64;

export function ProgramTimeline({
  event,
  activities,
  onEdit,
  rooms: availableRooms = [],
  onCreate,
  onReschedule,
  onSwap,
  onSelect,
  selectedActivityId,
  inlineEditor,
  onMontage,
}: {
  event: FlowEvent;
  activities: Activity[];
  onEdit: (activity: Activity) => void;
  rooms?: Room[];
  onCreate?: (range: ProgramRange) => void;
  onReschedule?: (activity: Activity, range: ProgramRange) => Promise<void>;
  onSwap?: (activity: Activity) => void;
  onSelect?: (activity: Activity) => void;
  selectedActivityId?: string;
  inlineEditor?: { item: Activity; content: ReactNode };
  onMontage?: (action:MontageAction)=>Promise<MontageResult>;
}) {
  const id = useId();
  const [cutAt,setCutAt]=useState<number|null>(null);
  const montage=useProgramMontage(activities,onMontage);
  const [menu,setMenu]=useState<{x:number;y:number;at:number;item?:Activity;trigger:HTMLElement|null}|null>(null);
  const closeMenu=useCallback(()=>setMenu(null),[]);
  const nativeEditing=!!onMontage&&!inlineEditor;
  function placement(target:Activity,at:number): "before"|"after"|"inside" {
    const duration=target.ends_at-target.starts_at;
    return at-target.starts_at<Math.min(duration/4,5*PROGRAM_MINUTE)?"before":target.ends_at-at<Math.min(duration/4,5*PROGRAM_MINUTE)?"after":"inside";
  }
  function quietly(action:Promise<unknown>){void action.catch(()=>{});}
  function context(e:React.MouseEvent<HTMLElement>,item?:Activity){
    if(!nativeEditing)return;e.preventDefault();e.stopPropagation();
    if(item)setSelectedId(item.id);
    const bounds=canvas.current!.getBoundingClientRect();
    const at= Math.round((start+((e.clientX-bounds.left)/Math.max(1,bounds.width))*(end-start))/PROGRAM_MINUTE)*PROGRAM_MINUTE;
    setMenu({x:e.clientX,y:e.clientY,at:Math.max(start,Math.min(end,at)),item,trigger:e.currentTarget});
  }
  const viewport = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const inlineContent = useRef<HTMLDivElement>(null);
  const [inlineHeight, setInlineHeight] = useState(260);
  const [width, setWidth] = useState(720);
  const [chosenDay, setChosenDay] = useState(dateKey(event.starts_at));
  const [roomId, setRoomId] = useState("");
  const [zoom, setZoom] = useState(1);
  const [selectedId, setSelectedId] = useState("");
  const [listOpen, setListOpen] = useState(false);
  const [groupIds, setGroupIds] = useState<string[] | null>(null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const { first, last } = programDayBounds(event.starts_at, event.ends_at);
  const day = chosenDay >= first && chosenDay <= last ? chosenDay : first;
  const { start, end } = programDayRange(day, event.starts_at, event.ends_at);
  const colors = useMemo(() => programColorMap(activities), [activities]);
  const dayItems = useMemo(
    () => itemsInRange(activities, start, end),
    [activities, start, end],
  );
  const rooms = [
    ...new Map([
      ...availableRooms.map((item) => [item.id, item.name] as const),
      ...dayItems.map((item) => [item.room_id, item.room_name] as const),
    ]).entries(),
  ];
  const room = rooms.some(([key]) => key === roomId) ? roomId : "";
  const items = useMemo(
    () => dayItems.filter((item) => !room || item.room_id === room),
    [dayItems, room],
  );
  const canvasWidth = Math.max(1, width - 32) * zoom;
  const tracks = useMemo(
    () => buildProgramTracks(items, start, end, canvasWidth),
    [items, start, end, canvasWidth],
  );
  const projection = useMemo(
    () => projectProgramTracks(tracks, start, end, canvasWidth),
    [tracks, start, end, canvasWidth],
  );
  const projectedGroups = new Map<string, typeof projection.nodes>();
  for (const node of projection.nodes) {
    if (
      inlineEditor &&
      node.segment.items.length === 1 &&
      node.segment.items[0].id === inlineEditor.item.id
    )
      continue;
    const group = projectedGroups.get(node.roomKey) ?? [];
    group.push(node);
    projectedGroups.set(node.roomKey, group);
  }
  const axisY = projection.aboveRows * 76 + 16;
  const ticks = programTimeTicks(start, end);
  const dense = projection.nodes.some((node) => node.segment.items.length > 1);
  const selectedItem =
    inlineEditor?.item ??
    items.find((item) => item.id === (selectedId || selectedActivityId)) ??
    items[0];
  const step = PROGRAM_MINUTE;
  const editor = useTimelineEditor({
    event,
    activities,
    start,
    end,
    step,
    canvas,
    roomId: room || (rooms.length === 1 ? rooms[0][0] : undefined),
    onCreate,
    onReschedule: nativeEditing ? async(activity,range)=>{await montage.run({operation:"move",activity_id:activity.id,...range});} : onReschedule,
    onDropActivity: nativeEditing ? async(activity,target,at,swap)=>{await montage.run({operation:swap?"swap":"insert",activity_id:activity.id,target_id:target.id,position:placement(target,at),at});} : undefined,
    deferredSave: Boolean(inlineEditor),
  });
  useEffect(()=>{if(montage.busy)editor.resetFeedback()},[montage.busy,editor.resetFeedback]);
  const selected =
    selectedItem && editor.preview?.activity?.id === selectedItem.id
      ? { ...selectedItem, ...editor.preview.range }
      : selectedItem;
  const editing = editor.dragging || editor.saving || montage.busy;
  const focusedGroup =
    !inlineEditor &&
    onReschedule &&
    selectedItem &&
    projection.nodes.some(
      (node) =>
        node.segment.items.length > 1 &&
        node.segment.items.some((item) => item.id === selectedItem.id),
    );
  if (focusedGroup && selectedItem) {
    const left =
      ((Math.max(start, selectedItem.starts_at) - start) / (end - start)) *
      canvasWidth;
    const right =
      ((Math.min(end, selectedItem.ends_at) - start) / (end - start)) *
      canvasWidth;
    const labelWidth = Math.min(canvasWidth, 220);
    projectedGroups.set("__editing", [
      {
        segment: {
          id: `focus-${selectedItem.id}`,
          items: [selectedItem],
          start: Math.max(start, selectedItem.starts_at),
          end: Math.min(end, selectedItem.ends_at),
        },
        roomName: selectedItem.room_name,
        roomKey: "__editing",
        side: "below",
        row: projection.belowRows,
        left,
        right,
        labelWidth,
        labelLeft: Math.max(
          0,
          Math.min(canvasWidth - labelWidth, (left + right - labelWidth) / 2),
        ),
      },
    ]);
  }
  if (inlineEditor) {
    const item = inlineEditor.item;
    const left = Math.max(
      0,
      Math.min(
        canvasWidth,
        ((item.starts_at - start) / (end - start)) * canvasWidth,
      ),
    );
    const right = Math.max(
      left,
      Math.min(
        canvasWidth,
        ((item.ends_at - start) / (end - start)) * canvasWidth,
      ),
    );
    const labelWidth = Math.min(canvasWidth, 360);
    projectedGroups.set("__inline", [
      {
        segment: {
          id: `inline-${item.id}`,
          items: [item],
          start: Math.max(start, item.starts_at),
          end: Math.min(end, item.ends_at),
        },
        roomName: item.room_name,
        roomKey: "__inline",
        side: "below",
        row: projection.belowRows,
        left,
        right,
        labelWidth,
        labelLeft: Math.max(
          0,
          Math.min(canvasWidth - labelWidth, (left + right - labelWidth) / 2),
        ),
      },
    ]);
  }
  const plotHeight =
    axisY +
    (projection.belowRows + (focusedGroup ? 1 : 0)) * 76 +
    24 +
    (inlineEditor ? inlineHeight + 60 : 0);
  const inlineId = inlineEditor?.item.id;
  const inlineDay = inlineEditor
    ? dateKey(inlineEditor.item.starts_at)
    : undefined;
  const directEditing = Boolean(onSelect);
  useEffect(() => {
    const element = inlineContent.current;
    if (!inlineId || !element) return;
    const measure = () => { const height = element.getBoundingClientRect().height; if (height > 0) setInlineHeight(height); };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [inlineId]);
  useEffect(() => {
    if (!inlineId || !inlineDay) return;
    setChosenDay(inlineDay);
    setRoomId("");
    setSelectedId(inlineId);
  }, [inlineId, inlineDay]);
  useEffect(() => {
    if (directEditing) editor.resetFeedback();
  }, [inlineId, directEditing, editor.resetFeedback]);
  const selectedIndex = items.findIndex((item) => item.id === selected?.id);
  const group = groupIds ? new Set(groupIds) : null;
  const listItems = items.filter(
    (item) =>
      (!group || group.has(item.id)) &&
      `${item.title} ${item.speaker} ${item.room_name}`
        .toLocaleLowerCase("ru")
        .includes(query.trim().toLocaleLowerCase("ru")),
  );
  const pageCount = Math.max(1, Math.ceil(listItems.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const visibleItems = listItems.slice(
    currentPage * PAGE_SIZE,
    (currentPage + 1) * PAGE_SIZE,
  );

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    if (typeof ResizeObserver === "undefined") {
      const measure = () => setWidth(element.clientWidth || 720);
      measure();
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  function changeDay(value: string) {
    if (!value) return;
    setChosenDay(value);
    setGroupIds(null);
    setQuery("");
    setPage(0);
    viewport.current?.scrollTo({ left: 0, top: 0 });
  }
  function changeZoom(value: number) {
    const next = Math.max(1, Math.min(MAX_ZOOM, value));
    const element = viewport.current;
    const center = element
      ? (element.scrollLeft + width / 2) / Math.max(1, canvasWidth)
      : 0;
    setZoom(next);
    requestAnimationFrame(() => {
      element?.scrollTo({
        left:
          next === 1
            ? 0
            : Math.max(0, center * Math.max(1, width - 32) * next - width / 2),
      });
    });
  }
  function selectItem(item: Activity) {
    if (onSelect) {
      onSelect(item);
      setListOpen(false);
      return;
    }
    setSelectedId(item.id);
    const element = viewport.current;
    if (element && zoom > 1)
      element.scrollTo({
        left: Math.max(
          0,
          ((Math.max(start, item.starts_at) - start) / (end - start)) *
            canvasWidth -
            width / 3,
        ),
      });
  }
  function selectSegment(segment: TimelineSegment) {
    setSelectedId(segment.items[0].id);
    if (onSelect && segment.items.length === 1) {
      onSelect(segment.items[0]);
      return;
    }
    setSelectedId(segment.items[0].id);
    setQuery("");
    setPage(0);
    setGroupIds(
      segment.items.length > 1 ? segment.items.map((item) => item.id) : null,
    );
    if (segment.items.length > 1) setListOpen(true);
  }
  function tickLabel(value: number) {
    return value === end && dateKey(value) !== day ? "24:00" : timeLabel(value);
  }

  return (
    <section
      className={`program-timeline ${cutAt!==null?"timeline-cutting":""} ${editing ? "is-editing" : ""} ${inlineEditor ? "has-inline-editor" : ""}`}
      aria-label="Графическое расписание"
      onKeyDownCapture={(e) => {
        if(nativeEditing&&!((e.target as HTMLElement).closest("input,textarea,select,[contenteditable=true],[role=menu]"))){
          if(e.key==="Escape"&&montage.clipboard){e.preventDefault();montage.clear();return;}
          if(e.ctrlKey||e.metaKey){const key=e.key.toLowerCase();if(key==="z"&&e.shiftKey)return;if(["x","c","v","z"].includes(key)){e.preventDefault();if(editing||e.repeat)return;
            if(key==="z")quietly(montage.undo());else if(selectedItem&&(key==="x"||key==="c"))montage.copy(selectedItem,key==="c");else if(key==="v")quietly(montage.paste(selectedItem,"before"));return;}}
        }

        if (e.key === "Escape" && editor.dragging) {
          e.preventDefault();
          e.stopPropagation();
          editor.cancel();
        }
      }}
    >
      <div className="timeline-toolbar">
        {first === last ? (
          <h3>{dateLabel(start, { year: "numeric" })}</h3>
        ) : (
          <div className="timeline-day">
            <button
              className="icon-button"
              aria-label="Предыдущий день программы"
              disabled={day === first || editing}
              onClick={() => changeDay(shiftProgramDay(day, -1))}
            >
              <ChevronLeft size={18} />
            </button>
            <label>
              <span className="sr-only">День программы</span>
              <input
                type="date"
                min={first}
                max={last}
                value={day}
                disabled={editing}
                onChange={(e) => changeDay(e.target.value)}
              />
            </label>
            <button
              className="icon-button"
              aria-label="Следующий день программы"
              disabled={day === last || editing}
              onClick={() => changeDay(shiftProgramDay(day, 1))}
            >
              <ChevronRight size={18} />
            </button>
          </div>
        )}
        <div className="timeline-view-controls">
          {rooms.length > 1 && (
            <label className="timeline-room-filter">
              <span className="sr-only">Аудитория на шкале</span>
              <select
                value={room}
                disabled={editing}
                onChange={(e) => {
                  setRoomId(e.target.value);
                  setGroupIds(null);
                  setPage(0);
                }}
              >
                <option value="">Все аудитории</option>
                {rooms.map(([key, name]) => (
                  <option key={key} value={key}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div
            className="timeline-zoom"
            role="group"
            aria-label="Масштаб расписания"
          >
            <button
              aria-label="Уменьшить масштаб расписания"
              disabled={zoom === 1 || editing}
              onClick={() => changeZoom(zoom / 2)}
            >
              <Minus size={16} />
            </button>
            <button
              className="timeline-fit"
              disabled={editing}
              onClick={() => changeZoom(1)}
              title="Вместить всё расписание в ширину экрана"
            >
              {zoom === 1 ? "Весь день" : `×${zoom} · Вместить`}
            </button>
            <button
              aria-label="Увеличить масштаб расписания"
              disabled={zoom === MAX_ZOOM || editing}
              onClick={() => changeZoom(zoom * 2)}
            >
              <Plus size={16} />
            </button>
          </div>
        </div>
      </div>
      {onMontage && <div className="timeline-montage-toolbar"><span>Правая кнопка — монтаж · Alt + клик — разрез · Shift + перенос на пункт — обмен</span><button type="button" className="text-button" disabled={!montage.canUndo||editing||!!inlineEditor} onClick={()=>quietly(montage.undo())}><Undo2 size={16}/>Отменить</button></div>}
      <p className={onMontage && !inlineEditor ? "sr-only" : "timeline-caption"} id={`${id}-hint`}>
        {onSelect ? (
          "Тяните отрезок для переноса, края — для изменения длительности. Время сохраняется сразу. Нажмите без перетаскивания, чтобы изменить название."
        ) : (
          <>
            Пунктов: {items.length} · время по МСК. Выберите отрезок для
            деталей.
            {dense
              ? " Мелкие пункты объединены в группы с числом — откройте группу или увеличьте масштаб."
              : ""}
            {zoom > 1 ? " Шкалу можно прокручивать по горизонтали." : ""}
            {onCreate ? " Новый пункт — выделите время на основной линии." : ""}
            {onReschedule && (
              <span className="sr-only">
                Alt и стрелки влево и вправо перемещают пункт целиком. Стрелки на краях меняют выбранную границу. Shift
                увеличивает шаг до 15 минут. Esc отменяет перетаскивание.
              </span>
            )}
          </>
        )}
      </p>
      {(onCreate || onReschedule) && (
        <div className={`timeline-edit-feedback ${onMontage && !inlineEditor ? "timeline-native-feedback" : ""}`} role="status">
          {onMontage && !inlineEditor ? (
            montage.busy ? "Сохраняем программу…" : editor.dropTarget ? `${editor.dropTarget.swap ? "Поменять местами" : placement(activities.find(a=>a.id===editor.dropTarget!.id)!,editor.dropTarget.at)==="inside" ? "Вставить внутрь" : "Вставить рядом"} · ${timeLabel(editor.dropTarget.at)}` : editor.preview ? `${editor.preview.activity?.title}: ${timeLabel(editor.preview.range.starts_at)}–${timeLabel(editor.preview.range.ends_at)}` : montage.notice || editor.notice || "Перенос и края сохраняются сразу · шаг 1 минута"
          ) : editor.saving
              ? onSelect ? "Выбираем время…" : "Сохраняем время…"
              : editor.preview
                ? `${editor.preview.activity?.title ?? "Новый пункт"}: ${timeLabel(editor.preview.range.starts_at)}–${timeLabel(editor.preview.range.ends_at)} МСК`
                : editor.notice || (onSelect
                  ? inlineEditor ? "Не сохранено · галочка или Enter — сохранить · Esc — отменить" : "Шаг — 1 минута · Alt + стрелки — перенос · Shift — 15 минут"
                  : `Перетащите отрезок для переноса, края — для изменения длины. Шаг ${step / PROGRAM_MINUTE} мин.`)}
        </div>
      )}
      <div
        ref={viewport}
        className="timeline-scroll"
        tabIndex={0}
        role="region"
        aria-label="Временная шкала программы"
        aria-describedby={`${id}-hint`}
      >
        <div
          className="timeline-canvas"
          ref={canvas}
          onContextMenu={e=>context(e)}
          onPointerMove={e=>{if(nativeEditing&&e.altKey){const b=e.currentTarget.getBoundingClientRect();setCutAt(Math.max(start,Math.min(end,Math.round((start+(e.clientX-b.left)/b.width*(end-start))/PROGRAM_MINUTE)*PROGRAM_MINUTE)))}else setCutAt(null)}}
          onPointerLeave={()=>setCutAt(null)}
          onKeyUp={e=>{if(e.key==="Alt")setCutAt(null)}}
          style={{ width: canvasWidth, height: plotHeight }}
        >
          <div
            className="timeline-axis"
            style={{ top: axisY }}
            aria-hidden="true"
          >
            {ticks.map((tick, index) => (
              <span
                key={tick}
                className={`timeline-tick ${index === 0 ? "timeline-tick-first" : index === ticks.length - 1 ? "timeline-tick-last" : "timeline-tick-interior"}`}
                style={{ left: `${((tick - start) * 100) / (end - start)}%` }}
              >
                {tickLabel(tick)}
              </span>
            ))}
          </div>
          {cutAt!==null && <div className="timeline-cut-guide" aria-hidden="true" style={{left:(cutAt-start)/(end-start)*canvasWidth,height:plotHeight}}><span>Разрез · {timeLabel(cutAt)}</span></div>}
          {onCreate && (
            <button
              type="button"
              className="timeline-create-track"
              style={{ top: axisY - 16 }}
              aria-label="Добавить пункт на шкале"
              aria-describedby={`${id}-hint`}
              disabled={editor.saving}
              onPointerDown={(e) => editor.begin(e)}
              {...editor.pointerHandlers}
              onClick={(e) => {
                if (e.detail === 0) editor.createAtStart();
              }}
            />
          )}
          {editor.preview && !editor.preview.activity && (
            <div
              className="timeline-new-range"
              aria-hidden="true"
              style={{
                top: axisY - 9,
                left:
                  ((editor.preview.range.starts_at - start) / (end - start)) *
                  canvasWidth,
                width:
                  ((editor.preview.range.ends_at -
                    editor.preview.range.starts_at) /
                    (end - start)) *
                  canvasWidth,
              }}
            />
          )}
          {[...projectedGroups].map(([key, nodes]) => (
            <div
              className="timeline-track"
              role="group"
              aria-label={`${key === "__editing" || key === "__inline" ? "Редактирование: " : ""}${nodes[0].roomName}`}
              key={key}
            >
              {nodes.map((node) => {
                const segment = node.segment;
                const multiple = segment.items.length > 1;
                const item = segment.items[0];
                const range =
                  !multiple && editor.preview?.activity?.id === item.id
                    ? editor.preview.range
                    : null;
                const segmentStart = range
                  ? Math.max(start, range.starts_at)
                  : segment.start;
                const segmentEnd = range
                  ? Math.min(end, range.ends_at)
                  : segment.end;
                const left = range
                  ? ((segmentStart - start) / (end - start)) * canvasWidth
                  : node.left;
                const right = range
                  ? ((segmentEnd - start) / (end - start)) * canvasWidth
                  : node.right;
                const labelLeft = Math.max(
                  0,
                  Math.min(
                    canvasWidth - node.labelWidth,
                    (left + right - node.labelWidth) / 2,
                  ),
                );
                const selectedNode = segment.items.some(
                  (item) => item.id === selected?.id,
                );
                const label = multiple
                  ? `${segment.items.length} пунктов · ${timeLabel(segment.start)}–${tickLabel(segment.end)}`
                  : `${segment.items[0].title} · ${timeLabel(segment.items[0].starts_at)}–${timeLabel(segment.items[0].ends_at)}`;
                const lineY =
                  node.side === "above"
                    ? axisY - 42 - node.row * 76
                    : axisY + 44 + node.row * 76;
                const color =
                  colors.get(segment.items[0].id) ?? PROGRAM_COLORS[0];
                return (
                  <div
                    key={segment.id}
                    className={`timeline-node ${montage.clipboard?.id===item.id&&!montage.clipboard.copy?"timeline-is-cut":""} ${editor.dropTarget?.id===item.id?"timeline-drop-target":""} timeline-node-${node.side} ${selectedNode ? "is-selected" : ""} ${right - left < 44 ? "is-compact" : ""} ${node.roomKey === "__inline" ? "timeline-node-inline" : ""}`}
                    data-row={node.row}
                    style={
                      {
                        left,
                        width: right - left,
                        top: lineY,
                        "--projection-color": color,
                        "--projection-length": `${Math.abs(axisY - lineY)}px`,
                      } as CSSProperties
                    }
                  >
                    <i
                      className="timeline-projection timeline-projection-start"
                      aria-hidden="true"
                    />
                    <i
                      className="timeline-projection timeline-projection-end"
                      aria-hidden="true"
                    />
                    {node.roomKey === "__inline" ? (
                      <>
                        <button
                          type="button"
                          className="timeline-inline-move"
                          aria-label={`Переместить ${item.title}`}
                          disabled={editor.saving}
                          onPointerDown={(e) => editor.begin(e, item, "move")}
                          {...editor.pointerHandlers}
                          onKeyDown={(e) => editor.moveWithKeyboard(e, item)}
                        >
                          <i
                            className="timeline-event-line"
                            style={{ background: color }}
                            aria-hidden="true"
                          />
                        </button>
                        <div
                          ref={inlineContent}
                          className="timeline-inline-content"
                          style={{
                            left: labelLeft - left,
                            width: node.labelWidth,
                          }}
                        >
                          {inlineEditor?.content}
                        </div>
                      </>
                    ) : (
                      <button
                        type="button"
                        className={`timeline-segment ${multiple ? "timeline-cluster" : onReschedule ? "timeline-movable" : ""}`}
                        data-program-item={multiple?undefined:item.id}
                        aria-label={label}
                        onContextMenu={e=>{if(!multiple)context(e,item)}}
                        aria-pressed={selectedNode}
                        title={`${label} · ${node.roomName}`}
                        onClick={(event) => { if(editor.shouldIgnoreClick(event.detail,multiple?"":item.id))return;if(event.altKey&&nativeEditing&&!multiple){const bounds=canvas.current!.getBoundingClientRect();const at=Math.round((start+(event.clientX-bounds.left)/bounds.width*(end-start))/PROGRAM_MINUTE)*PROGRAM_MINUTE;quietly(montage.run({operation:"split",activity_id:item.id,at}));}else selectSegment(segment); }}
                        disabled={editor.saving}
                        onPointerDown={
                          onReschedule && !multiple
                            ? (e) => {
                                if(e.altKey&&nativeEditing){editor.resetClickGuard();e.preventDefault();return;}
                                setSelectedId(item.id);
                                editor.begin(e, item, "move");
                              }
                            : undefined
                        }
                        {...editor.pointerHandlers}
                        onKeyDown={
                          onReschedule && !multiple
                            ? (e) => {
                                if(nativeEditing&&(e.key==="ContextMenu"||(e.key==="F10"&&e.shiftKey))){
                                  e.preventDefault();const bounds=e.currentTarget.getBoundingClientRect();
                                  setMenu({item,trigger:e.currentTarget,x:bounds.left,y:bounds.bottom,at:Math.round((item.starts_at+item.ends_at)/2/PROGRAM_MINUTE)*PROGRAM_MINUTE});return;
                                }
                                if(e.key==="Enter"||e.key===" ")editor.resetClickGuard();editor.moveWithKeyboard(e, item);
                              }
                            : undefined
                        }
                      >
                        <span
                          className="timeline-node-label"
                          style={{
                            left: labelLeft - left,
                            width: node.labelWidth,
                          }}
                        >
                          <strong>
                            {multiple ? (
                              <>
                                <Layers size={13} aria-hidden="true" />
                                Группа · {segment.items.length}
                              </>
                            ) : (
                              segment.items[0].title
                            )}
                          </strong>
                          <small>
                            {timeLabel(segmentStart)}–{tickLabel(segmentEnd)}
                            {rooms.length > 1 ? ` · ${node.roomName}` : ""}
                          </small>
                        </span>
                        <i
                          className="timeline-event-line"
                          style={{
                            background: segmentBackground(segment, colors),
                          }}
                          aria-hidden="true"
                        />
                      </button>
                    )}
                    {onReschedule &&
                      selectedNode &&
                      !multiple &&
                      (["start", "end"] as const).map(
                        (edge) =>
                          (edge === "start"
                            ? item.starts_at >= start
                            : item.ends_at <= end) && (
                            <button
                              type="button"
                              key={edge}
                              className={`timeline-resize-handle timeline-resize-${edge}`}
                              aria-label={`Изменить ${edge === "start" ? "начало" : "окончание"} ${item.title}`}
                              aria-describedby={`${id}-hint`}
                              disabled={editor.saving}
                              title={`${edge === "start" ? "Начало" : "Окончание"}: потяните или используйте ← →`}
                              onPointerDown={(e) => editor.begin(e, item, edge)}
                              {...editor.pointerHandlers}
                              onKeyDown={(e) =>
                                editor.resizeWithKeyboard(e, item, edge)
                              }
                            >
                              <i aria-hidden="true" />
                            </button>
                          ),
                      )}
                  </div>
                );
              })}
            </div>
          ))}
          {tracks.length === 0 && !inlineEditor && (
            <p className="timeline-empty">
              {onCreate
                ? "Выделите отрезок на линии, чтобы добавить первый пункт."
                : "На этот день пока ничего не запланировано."}
            </p>
          )}
        </div>
      </div>
      <FormError error={editor.error || montage.error} />
      {menu && <TimelineMenu x={menu.x} y={menu.y} trigger={menu.trigger} onClose={closeMenu} items={(()=>{
        const item=menu.item,clip=montage.clipboard;
        const entries:TimelineMenuItem[]=[];
        if(item){entries.push({label:"Вырезать",shortcut:"Ctrl / ⌘ X",action:()=>montage.copy(item)},{label:"Копировать",shortcut:"Ctrl / ⌘ C",action:()=>montage.copy(item,true)},
          {label:`Разрезать здесь · ${timeLabel(menu.at)}`,shortcut:"Alt + клик",disabled:menu.at-item.starts_at<PROGRAM_MINUTE||item.ends_at-menu.at<PROGRAM_MINUTE,action:()=>quietly(montage.run({operation:"split",activity_id:item.id,at:menu.at}))});}
        if(clip&&(clip.copy||clip.id!==item?.id)){if(item){for(const position of ["before","inside","after"] as const)entries.push({label:`Вставить ${position==="before"?"перед":position==="after"?"после":"внутрь"}`,disabled:position==="inside"&&(menu.at-item.starts_at<PROGRAM_MINUTE||item.ends_at-menu.at<PROGRAM_MINUTE),action:()=>quietly(montage.paste(item,position,menu.at))});
          entries.push({label:"Поменять местами с вырезанным",disabled:clip.copy,action:()=>{quietly(montage.run({operation:"swap",activity_id:clip.id,target_id:item.id}).then(()=>montage.clear()))}});
        }else entries.push({label:`Вставить в ${timeLabel(menu.at)}`,shortcut:"Ctrl / ⌘ V",action:()=>quietly(montage.paste(undefined,undefined,menu.at,room||undefined))});}
        entries.push({label:"Отменить последнее действие",shortcut:"Ctrl / ⌘ Z",disabled:!montage.canUndo,action:()=>quietly(montage.undo())});return entries;
      })()}/>}
      {!onSelect && selected && (
        <article
          className="timeline-detail"
          aria-label="Выбранный пункт программы"
          style={{ borderLeftColor: colors.get(selected.id) }}
        >
          <div className="timeline-detail-copy">
            <p className="timeline-detail-time">
              {dateLabel(selected.starts_at)} · {timeLabel(selected.starts_at)}–
              {dateKey(selected.starts_at) !== dateKey(selected.ends_at)
                ? `${dateLabel(selected.ends_at)} `
                : ""}
              {timeLabel(selected.ends_at)} МСК
            </p>
            <h4>{selected.title}</h4>
            <p>
              {selected.room_name}
              {selected.speaker ? ` · ${selected.speaker}` : ""}
            </p>
            {selected.description && (
              <p className="timeline-detail-description">
                {selected.description}
              </p>
            )}
            <small>
              {selected.registration_required === false ? <>Без отдельной записи · в расписании у {selected.taken}</> : <>{selected.taken} занято ·{" "}
              {Math.max(0, selected.capacity - selected.taken)} свободно
              {selected.waiting_count > 0
                ? ` · в очереди: ${selected.waiting_count}`
                : ""}</>}
            </small>
          </div>
          <div className="timeline-detail-actions">
            <div className="timeline-selection-nav">
              <button
                className="icon-button"
                aria-label="Предыдущий пункт программы"
                disabled={selectedIndex <= 0}
                onClick={() => selectItem(items[selectedIndex - 1])}
              >
                <ChevronLeft size={18} />
              </button>
              <span>
                {selectedIndex + 1} / {items.length}
              </span>
              <button
                className="icon-button"
                aria-label="Следующий пункт программы"
                disabled={selectedIndex === items.length - 1}
                onClick={() => selectItem(items[selectedIndex + 1])}
              >
                <ChevronRight size={18} />
              </button>
            </div>
            {onSwap && activities.length > 1 && <button
              className="button secondary small-button"
              disabled={editing}
              onClick={() => onSwap(selectedItem!)}
            ><ArrowLeftRight size={16} />Поменять местами</button>}
            <button
              className="button secondary small-button"
              onClick={() => onEdit(selected)}
              aria-label={`Изменить пункт программы ${selected.title}`}
            >
              <Pencil size={16} />
              Изменить
            </button>
          </div>
        </article>
      )}
      {!onSelect && (
        <button
          className="text-button timeline-list-toggle"
          aria-expanded={listOpen}
          aria-controls={`${id}-list`}
          onClick={() => {
            setListOpen(!listOpen);
            setGroupIds(null);
            setPage(0);
          }}
        >
          <List size={17} />
          {listOpen
            ? "Скрыть список"
            : `Найти пункт в списке · ${items.length}`}
        </button>
      )}
      {listOpen && (!onSelect || groupIds) && (
        <div className="timeline-list" id={`${id}-list`}>
          {groupIds && (
            <div className="timeline-group-heading">
              <strong>В выбранной группе: {groupIds.length}</strong>
              <button
                className="text-button"
                onClick={() => {
                  setGroupIds(null);
                  setPage(0);
                }}
              >
                Все пункты дня
              </button>
            </div>
          )}
          <label className="timeline-search">
            <Search size={17} />
            <input
              type="search"
              aria-label="Найти пункт программы"
              placeholder="Название, спикер или аудитория"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0);
              }}
            />
          </label>
          <ul>
            {visibleItems.map((item) => (
              <li key={item.id}>
                <button
                  aria-pressed={item.id === selected?.id}
                  onClick={() => selectItem(item)}
                >
                  <i
                    aria-hidden="true"
                    style={{ background: colors.get(item.id) }}
                  />
                  <time>
                    {timeLabel(item.starts_at)}–{timeLabel(item.ends_at)}
                  </time>
                  <span>
                    <strong>{item.title}</strong>
                    <small>
                      {item.room_name}
                      {item.speaker ? ` · ${item.speaker}` : ""}
                    </small>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {!listItems.length && (
            <p className="timeline-empty">
              Пункты не найдены. Попробуйте другой запрос.
            </p>
          )}
          {pageCount > 1 && (
            <nav
              className="timeline-pagination"
              aria-label="Страницы пунктов программы"
            >
              <button
                className="icon-button"
                aria-label="Предыдущая страница пунктов"
                disabled={currentPage === 0}
                onClick={() => setPage(currentPage - 1)}
              >
                <ChevronLeft size={18} />
              </button>
              <span>
                {currentPage * PAGE_SIZE + 1}–
                {Math.min(listItems.length, (currentPage + 1) * PAGE_SIZE)} из{" "}
                {listItems.length}
              </span>
              <button
                className="icon-button"
                aria-label="Следующая страница пунктов"
                disabled={currentPage === pageCount - 1}
                onClick={() => setPage(currentPage + 1)}
              >
                <ChevronRight size={18} />
              </button>
            </nav>
          )}
        </div>
      )}
    </section>
  );
}
