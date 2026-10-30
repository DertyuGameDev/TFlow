import { Check, Clock3, Users } from "lucide-react";
import type { Activity } from "../../lib/types";
import { dateLabel, timeLabel } from "../../lib/time";
import { activityAvailability } from "../../lib/activities";

type Props = {
  activity: Activity;
  schedule: Activity[];
  busy: boolean;
  canInteract: boolean;
  onToggle: () => void;
};

export function ActivityRow({ activity, schedule, busy, canInteract, onToggle }: Props) {
  const state = activityAvailability(activity, schedule, Date.now());
  return <article className="simple-activity activity-program-row">
    <span className="activity-time-column"><time>{timeLabel(activity.starts_at)}</time><small>{timeLabel(activity.ends_at)}</small><small>{dateLabel(activity.starts_at)}</small></span>
    <div><strong>{activity.title}</strong><small>{activity.room_name}{activity.speaker ? ` · ${activity.speaker}` : ""}</small>
      {activity.description && <p>{activity.description}</p>}
      <div className="activity-availability"><span><Users size={14} />{state.free ? `Свободно ${state.free} из ${activity.capacity} мест` : "Свободных мест нет"}</span>
        {state.registered && <span className="activity-registered"><Check size={14} />Вы записаны</span>}
      </div>
      {state.conflict && <p className="activity-conflict"><Clock3 size={14} /><span>Пересекается с «{state.conflict.title}» ({timeLabel(state.conflict.starts_at)}–{timeLabel(state.conflict.ends_at)}). Сначала отмените ту запись или выберите другое время.</span></p>}
    </div>
    {canInteract && <button className={`button small-button ${state.registered ? "secondary" : "primary"}`} disabled={busy || state.blocked} onClick={onToggle}>
      {state.registered ? "Отменить запись" : state.closed ? "Запись закрыта" : !state.free ? "Мест нет" : state.conflict ? "Время занято" : "Записаться"}
    </button>}
  </article>;
}
