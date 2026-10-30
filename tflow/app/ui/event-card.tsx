"use client";
import { ArrowUpRight, Bookmark, CalendarDays, MapPin, Users, Wifi } from "lucide-react";
import { dateLabel, timeLabel } from "../../lib/time";
import type { FlowEvent } from "../../lib/types";
export function EventArt({cover,title,className=""}:{cover:string;title?:string;className?:string}) {
  return <div className={`event-art art-${cover} ${className}`} aria-hidden="true">
    {cover==="photo"?<div className="photo-cover"/>:<><span className="art-orbit"/><span className="art-shape shape-one"/><span className="art-shape shape-two"/><span className="art-shape shape-three"/><span className="art-dot"/>{title&&<span className="art-word">{title}</span>}</>}
  </div>;
}
export function EventCard({event,onOpen,onSave,list=false}:{event:FlowEvent;onOpen:()=>void;onSave:()=>void;list?:boolean}){
  return <article className={`event-card ${list?"event-card-list":""}`}>
    <button className="card-cover" onClick={onOpen} tabIndex={-1} aria-label={event.title}><EventArt cover={event.cover} title={event.topic==="Искусственный интеллект"?"AI":event.topic==="Разработка"?"</>":undefined}/><span className="cover-tag">{event.format==="Онлайн"?<Wifi size={13}/>:null}{event.kind}</span>{event.status==="draft"&&<span className="draft-tag">Черновик</span>}</button>
    <div className="card-body"><div className="card-topic">{event.topic}</div><h2><button onClick={onOpen}>{event.title}<ArrowUpRight className="card-arrow" size={19}/></button></h2>
      <div className="card-meta"><span><CalendarDays size={15}/>{dateLabel(event.starts_at)} · {timeLabel(event.starts_at)}</span><span>{event.format==="Онлайн"?<Wifi size={15}/>:<MapPin size={15}/>}<span>{event.city}{event.format==="Онлайн"?"":" · "+event.venue}</span></span></div>
      <footer><div><strong>Бесплатно</strong><span className="card-people"><Users size={14}/>{event.activity_count} активности</span></div><button className={`save-button ${event.saved?"is-saved":""}`} aria-label={event.saved?`Убрать из избранного: ${event.title}`:`В избранное: ${event.title}`} aria-pressed={!!event.saved} onClick={onSave}><Bookmark size={19} fill={event.saved?"currentColor":"none"}/></button></footer>
    </div>
  </article>;
}
