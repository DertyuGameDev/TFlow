import {useCallback,useRef,useState} from 'react';
import type {Activity} from '../../lib/types';
import type {MontageAction,MontageResult} from '../../lib/program-montage';
export function useProgramMontage(activities:Activity[],onAction?: (action:MontageAction)=>Promise<MontageResult>){
 const [clipboard,setClipboard]=useState<{id:string;updated:number;copy:boolean}|null>(null);
 const [history,setHistory]=useState<string[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const locked=useRef(false);
 const run=useCallback(async(action:MontageAction)=>{if(!onAction||locked.current)throw new Error('Дождитесь сохранения программы');locked.current=true;setBusy(true);setError('');
  try{const result=await onAction(action);if(action.operation==='undo')setHistory(old=>old.slice(0,-1));else if(result.undo)setHistory(old=>[...old,result.undo!].slice(-30));setNotice(action.operation==='undo'?'Последнее изменение отменено':action.operation==='split'?'Созданы самостоятельные части. Записи и очередь сохранены в обеих. Ctrl / ⌘ Z — отменить':'Сохранено · Ctrl / ⌘ Z — отменить');return result;}
  catch(e){setError((e as Error).message);throw e;}finally{locked.current=false;setBusy(false)}
 },[onAction]);
 function copy(item:Activity,duplicate=false){setClipboard({id:item.id,updated:item.updated_at,copy:duplicate});setError('');setNotice(`${duplicate?'Копируется':'Вырезается'} «${item.title}». Выберите место и вставьте. ${duplicate?"Копия создастся без записей участников. ":""}Esc — отменить.`)}
 async function paste(target?:Activity,position?:'before'|'after'|'inside',at?:number,room_id?:string){
  if(!clipboard)return;const source=activities.find(a=>a.id===clipboard.id);
  if(!source||source.updated_at!==clipboard.updated){setError('Пункт в буфере изменился. Вырежьте или скопируйте его заново.');return;}
  await run({operation:clipboard.copy?'copy':'insert',activity_id:source.id,target_id:target?.id,position,at,room_id});
  if(!clipboard.copy)setClipboard(null);
 }
 async function undo(){const token=history.at(-1);if(token)await run({operation:'undo',undo:token})}
 return {run,paste,copy,undo,clipboard,clear:()=>setClipboard(null),busy,error,notice,canUndo:history.length>0};
}
