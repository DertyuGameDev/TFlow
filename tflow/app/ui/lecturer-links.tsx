import { useEffect, useState } from "react";
import { Copy } from "lucide-react";
import type { FlowEvent } from "../../lib/types";
import { dateLabel, timeLabel } from "../../lib/time";
import { FormError, type Send } from "./forms";

type LinkRow = { id: string; title: string; starts_at: number; ends_at: number; key_id: string | null; credential: string | null };
export function LecturerLinks({event, send}:{event:FlowEvent;send:Send}) {
  const [rows,setRows]=useState<LinkRow[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(""),[copied,setCopied]=useState("");
  useEffect(()=>{let current=true;void send(`events/${event.id}/lecturer-links`,"POST",{operation:"ensure"}).then(value=>{if(current){const next=(value as {activities?:LinkRow[]}).activities;if(!Array.isArray(next))throw new Error("Не удалось получить ссылки лекторам");setRows(next)}}).catch(e=>{if(current)setError(e.message)});return()=>{current=false}},[event.id,event.updated_at,send]);
  async function change(id:string,operation:string){setBusy(true);setError("");try{const result=await send(`events/${event.id}/lecturer-links`,"POST",{activity_id:id,operation}) as {activities:LinkRow[]};setRows(old=>old.map(row=>result.activities.find(item=>item.id===row.id)??row));setCopied("")}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
  return <section className="management-card lecturer-links" aria-label="Ссылки лекторам"><h2>Ссылки лекторам</h2><p>Отдельная ссылка для каждой онлайн-активности. Вход — через свой аккаунт; начать можно по времени активности. Обновление или отзыв ссылки отключит прежнего лектора.</p><FormError error={error}/>
    {rows.length ? <ul>{rows.map(row=><li key={row.id}><div><h3>{row.title}</h3><p>{dateLabel(row.starts_at)} · {timeLabel(row.starts_at)}–{timeLabel(row.ends_at)} МСК</p></div><div className="access-key-actions">
      {row.credential && <label className="lecturer-link-field">Ссылка лектора<input aria-label={`Ссылка лектора: ${row.title}`} readOnly value={`${location.origin}/#lecture/${row.credential}`} autoComplete="off" onFocus={event=>event.currentTarget.select()}/></label>}
      {row.credential && <button className="button secondary small-button" onClick={()=>void navigator.clipboard.writeText(`${location.origin}/#lecture/${row.credential}`).then(()=>setCopied(row.id)).catch(()=>setError("Не удалось скопировать ссылку. Разрешите доступ к буферу обмена и повторите."))}><Copy size={16}/>{copied===row.id?"Скопировано":"Копировать ссылку"}</button>}
      <button className="text-button" disabled={busy||row.ends_at<=Date.now()} onClick={()=>void change(row.id,"issue")}>{row.credential?"Обновить ссылку":"Создать ссылку"}</button>
      {row.credential&&<button className="text-button" disabled={busy} onClick={()=>void change(row.id,"revoke")}>Отозвать</button>}
    </div></li>)}</ul>:<p>Добавьте онлайн-активность в программу — здесь появится её ссылка.</p>}
  </section>;
}
