"use client";
import { useState, type FormEvent } from "react";
import { AlertCircle, ArrowRight, LoaderCircle } from "lucide-react";
import { CITIES, type Community, type FlowEvent, type Profile, type Room } from "../../lib/types";
import { fromLocalInput, localInput } from "../../lib/time";
import { InterestPicker } from "./interest-picker";
import { CityPicker } from "./city-picker";
import { CategorySelect } from "./category-select";
export type Send = (path:string,method:string,body?:unknown)=>Promise<unknown>;
type Props={ send:Send;done:()=>void };
export function useSubmit(action:(data:FormData)=>Promise<void>) {
  const [error,setError]=useState(""),[busy,setBusy]=useState(false);
  async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();setError("");setBusy(true);try{await action(new FormData(e.currentTarget));}catch(e){setError(e instanceof Error?e.message:"Не удалось сохранить");}finally{setBusy(false);}}
  return {error,busy,submit};
}
export function FormError({error}:{error:string}){return error?<div className="form-error" role="alert"><AlertCircle size={18}/><span>{error}</span></div>:null;}
export function Submit({busy,label,disabled=false}:{busy:boolean;label:string;disabled?:boolean}){return <button className="button primary" type="submit" disabled={busy||disabled}>{busy?<LoaderCircle className="spin" size={18}/>:null}{busy?"Сохраняем…":label}{!busy&&<ArrowRight size={17}/>}</button>;}
export function EventForm({event,communities,send,done}:{event?:FlowEvent;communities:Community[]}&Props){
  const start=event?.starts_at??Date.now()+86400000;
  const {submit,error,busy}=useSubmit(async d=>{
    await send(event?`events/${event.id}`:"events",event?"PATCH":"POST",{
      title:d.get("title"),description:d.get("description"),starts_at:fromLocalInput(String(d.get("starts_at"))),ends_at:fromLocalInput(String(d.get("ends_at"))),
      city:d.get("city"),venue:d.get("venue"),address:d.get("address"),format:d.get("format"),topic:d.get("topic"),kind:d.get("kind"),cover:d.get("cover"),community_id:d.get("community_id")||null,
    });done();
  });
  return <form onSubmit={submit} className="flow-form">
    <label>Название мероприятия<input name="title" required placeholder="Например, Продуктовый день" defaultValue={event?.title}/></label>
    <label>Описание<textarea name="description" required rows={3} placeholder="О чём событие и кому будет интересно" defaultValue={event?.description}/></label>
    <div className="form-row"><label>Начало · МСК<input type="datetime-local" name="starts_at" required defaultValue={localInput(start)}/></label><label>Окончание · МСК<input type="datetime-local" name="ends_at" required defaultValue={localInput(event?.ends_at??start+8*3600000)}/></label></div>
    <div className="form-row"><CityPicker defaultValue={event?.city??"Москва"} cities={CITIES}/><label>Формат<select name="format" defaultValue={event?.format??"Очно"}><option>Очно</option><option>Онлайн</option><option>Гибрид</option></select></label></div>
    <label>Площадка<input name="venue" required defaultValue={event?.venue} placeholder="Название пространства или онлайн-площадки"/></label>
    <label>Адрес<input name="address" defaultValue={event?.address} placeholder="Улица, дом или информация о подключении"/></label>
    <div className="form-row"><CategorySelect defaultValue={event?.topic}/><label>Тип события<select name="kind" defaultValue={event?.kind??"Конференция"}>{["Конференция","Митап","Хакатон","Практикум","Встреча","Мастер-класс","Лекция"].map(t=><option key={t}>{t}</option>)}</select></label></div>
    <div className="form-row"><label>Сообщество<select name="community_id" defaultValue={event?.community_id??""}><option value="">Без сообщества</option>{communities.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>Обложка<select name="cover" defaultValue={event?.cover??"yellow"}>{[["yellow","Жёлтый"],["photo","Фотография"],["blue","Голубой"],["mint","Мятный"],["peach","Персиковый"],["violet","Сиреневый"]].map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label></div>
    <FormError error={error}/><div className="form-footer"><span className="muted small">{event?"Изменения проверяются на конфликты":"Сначала создадим черновик. Затем добавьте аудитории и программу"}</span><Submit busy={busy} label={event?"Сохранить":"Создать мероприятие"}/></div>
  </form>;
}
export function RoomForm({eventId,room,send,done}:{eventId:string;room?:Room}&Props){
  const {submit,error,busy}=useSubmit(async d=>{await send(room?`rooms/${room.id}`:`events/${eventId}/rooms`,room?"PATCH":"POST",{name:d.get("name"),capacity:Number(d.get("capacity"))});done();});
  return (
    <form className="flow-form" onSubmit={submit}>
      {room?.is_online && <p className="event-field-hint">Онлайн-аудитория — один вебинар внутри ТФлоу. Очные аудитории могут работать в это же время.</p>}
      <label>Название аудитории<input name="name" required placeholder="Например, Главный зал" defaultValue={room?.name}/></label>
      <label>{room?.is_online ? "Лимит зрителей" : "Вместимость"}<input type="number" name="capacity" min={1} required defaultValue={room?.capacity??30}/></label>
      <p className="muted small">Лимит активности не сможет превышать вместимость аудитории.</p>
      <FormError error={error}/>
      <div className="form-footer"><Submit busy={busy} label="Сохранить аудиторию"/></div>
    </form>
  );
}
