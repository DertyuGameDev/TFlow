import { useRef, useState } from "react";
import type { FlowEvent } from "../../lib/types";
import { fromLocalInput, localInput } from "../../lib/time";
import { FormError, Submit, useSubmit, type Send } from "./forms";

export function QuickEventForm({event,move=false,city="Москва",send,done}:{event?:FlowEvent;move?:boolean;city?:string;send:Send;done:(id?:string)=>void}) {
  const start=event?.starts_at??Date.now()+86400000;
  const [startValue,setStartValue]=useState(localInput(start));
  const [endValue,setEndValue]=useState(localInput(event?.ends_at??start+2*3600000));
  const previousStart=useRef(start);
  function changeStart(value:string){
    setStartValue(value);
    const next=fromLocalInput(value);
    if(!Number.isFinite(next))return;
    const delta=next-previousStart.current;
    previousStart.current=next;
    setEndValue(current=>{const end=fromLocalInput(current);return Number.isFinite(end)?localInput(end+delta):current;});
  }
  const {submit,error,busy}=useSubmit(async data=>{
    const dates={starts_at:fromLocalInput(String(data.get("starts_at"))),ends_at:fromLocalInput(String(data.get("ends_at"))),city:String(data.get("city")??event?.city??city),venue:data.get("venue"),address:String(data.get("address")??event?.address??"")};
    if(move&&event){await send(`events/${event.id}/move`,"PATCH",dates);done(event.id);return;}
    const result=await send(event?`events/${event.id}`:"events",event?"PATCH":"POST",{
      ...dates,title:data.get("title"),description:data.get("description")||`Информация о мероприятии «${data.get("title")}».`,
      capacity:Number(data.get("capacity")),format:event?.format??"Очно",topic:event?.topic??"Предпринимательство",kind:event?.kind??"Встреча",cover:event?.cover??"yellow",community_id:event?.community_id??null,
    }) as {id?:string};
    done(result.id??event?.id);
  });
  return <form className="flow-form quick-event-form" onSubmit={submit} onInvalidCapture={e=>{const details=(e.target as HTMLElement).closest("details");if(details)details.open=true;}}>
    {!move&&<label>Название события<input name="title" required minLength={3} maxLength={160} placeholder="О чём ваша встреча?" defaultValue={event?.title}/></label>}
    <div className="form-row"><label>Начало · МСК<input name="starts_at" type="datetime-local" required value={startValue} onChange={e=>changeStart(e.target.value)}/></label><label>Окончание · МСК<input name="ends_at" type="datetime-local" required min={startValue} value={endValue} onChange={e=>setEndValue(e.target.value)}/></label></div>
    <label>Где встречаемся<input name="venue" required minLength={2} maxLength={160} placeholder="Название площадки или адрес" defaultValue={event?.venue}/></label>
    {!move&&<label>Количество мест<input name="capacity" type="number" inputMode="numeric" required min={1} max={100000} defaultValue={event?.capacity??100}/></label>}
    <details className="optional-fields"><summary>Ещё немного информации</summary><label>Город<input name="city" required minLength={2} maxLength={80} defaultValue={event?.city??city}/></label><label>Адрес<input name="address" maxLength={240} defaultValue={event?.address}/></label>{!move&&<label>Описание<textarea name="description" maxLength={5000} rows={3} defaultValue={event?.description} placeholder="Что ждёт участников"/></label>}</details>
    {move&&<p className="muted small">Программа сдвинется вместе с событием. Участники получат уведомление. Пересечения проверим перед сохранением.</p>}
    {!move&&!event&&<p className="muted small">Сохраним как черновик. Вы сможете всё проверить перед публикацией.</p>}
    <FormError error={error}/><div className="form-footer"><Submit busy={busy} label={move?"Перенести событие":event?"Сохранить изменения":"Создать событие"}/></div>
  </form>;
}
