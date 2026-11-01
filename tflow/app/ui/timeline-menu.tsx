import {useEffect,useRef} from 'react';
import {createPortal} from 'react-dom';
export type TimelineMenuItem={label:string;shortcut?:string;disabled?:boolean;action:()=>void};
export function TimelineMenu({x,y,items,onClose,trigger}:{x:number;y:number;items:TimelineMenuItem[];onClose:()=>void;trigger:HTMLElement|null}){
 const ref=useRef<HTMLDivElement>(null);
 useEffect(()=>{ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  const outside=(e:PointerEvent)=>{if(!ref.current?.contains(e.target as Node))onClose()};window.addEventListener('pointerdown',outside);
  return()=>{window.removeEventListener('pointerdown',outside);if(trigger?.isConnected)trigger.focus({preventScroll:true})};
 },[onClose,trigger]);
 return createPortal(<div ref={ref} className="timeline-context-menu" role="menu" aria-label="Монтаж программы" style={{left:Math.min(x,Math.max(8,innerWidth-280)),top:Math.min(y,Math.max(8,innerHeight-340))}}
  onKeyDown={e=>{if(e.key==='Escape'||e.key==='Tab'){if(e.key==='Escape')e.preventDefault();e.stopPropagation();onClose();return;}if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();const buttons=[...ref.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];const index=buttons.indexOf(document.activeElement as HTMLButtonElement);buttons[e.key==='Home'?0:e.key==='End'?buttons.length-1:(index+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();}}}>
 {items.map(item=><button key={item.label} type="button" role="menuitem" disabled={item.disabled} onClick={()=>{onClose();item.action()}}><span>{item.label}</span>{item.shortcut&&<kbd>{item.shortcut}</kbd>}</button>)}
 </div>,document.body);
}
