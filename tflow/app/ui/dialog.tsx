"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
export function Modal({ title, subtitle, children, onClose, wide=false }: { title:string;subtitle?:string;children:ReactNode;onClose:()=>void;wide?:boolean }) {
  const ref=useRef<HTMLDialogElement>(null);
  const backdropPress=useRef(false);
  useEffect(()=>{
    const dialog=ref.current;
    const previous=document.activeElement as HTMLElement | null;
    dialog?.showModal();
    const old=document.body.style.overflow;
    document.body.style.overflow="hidden";
    return ()=>{ document.body.style.overflow=old;previous?.focus(); };
  },[]);
  return <dialog ref={ref} className={`modal ${wide?"modal-wide":""}`} onClose={onClose} onPointerDown={e=>{backdropPress.current=e.target===ref.current;}} onClick={e=>{if(backdropPress.current&&e.target===ref.current)ref.current?.close();}} aria-labelledby="modal-title">
    <header className="modal-heading"><div><h2 id="modal-title">{title}</h2>{subtitle&&<p>{subtitle}</p>}</div><button type="button" className="icon-button" aria-label="Закрыть" onClick={()=>ref.current?.close()}><X size={21}/></button></header>
    {children}
  </dialog>;
}
