import type { EventTimeFilter } from "../../lib/event-filters";
export type EventStatusFilter = Exclude<EventTimeFilter, "now" | "visited">;
export function EventTimeFilterControl({value,onChange}:{value:EventStatusFilter;onChange:(value:EventStatusFilter)=>void}) {
  return <div className="segmented event-time-filter" role="group" aria-label="Состояние мероприятий">
    {([["all","Все"],["active","Активные"],["past","Завершённые"]] as const).map(([id,label])=>
      <button type="button" key={id} className={value===id?"selected":""} aria-pressed={value===id} onClick={()=>onChange(id)}>{label}</button>)}
  </div>;
}
