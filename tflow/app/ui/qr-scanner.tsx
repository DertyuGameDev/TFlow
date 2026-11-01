import { useEffect, useRef, useState } from "react";
import { ArrowRight, Camera, Check, ImagePlus, LoaderCircle, RotateCcw, ScanLine, Search, X } from "lucide-react";
import type { FlowEvent, ScanResult } from "../../lib/types";
import { dateLabel, timeLabel } from "../../lib/time";
import type { Send } from "./forms";
import { ParticipantDetails } from "./profile-data";
import "../qr-scanner.css";

export function QRScanner({event,events,initialToken,send,onScan}:{event?:FlowEvent;events:FlowEvent[];initialToken?:string;send:Send;onScan:()=>void}) {
  const [selectedEventId,setSelectedEventId]=useState(""),[result,setResult]=useState<ScanResult|null>(null),[error,setError]=useState("");
  const selectedEvent=event??events.find(e=>e.id===selectedEventId)??(events.length===1?events[0]:undefined);
  const eventId=selectedEvent?.id??"";
  const [choosingEvent,setChoosingEvent]=useState(false),[query,setQuery]=useState("");
  const showEventPicker=!event&&events.length>1&&(choosingEvent||!selectedEvent);
  const visibleEvents=events.filter(e=>`${e.title} ${e.city} ${e.venue}`.toLocaleLowerCase("ru").includes(query.trim().toLocaleLowerCase("ru")));
  const [busy,setBusy]=useState(false),[camera,setCamera]=useState(false),[manual,setManual]=useState(initialToken??"");
  const [errorKind,setErrorKind]=useState<"scan"|"camera"|"image">("scan");
  const feedback=useRef<HTMLDivElement>(null);
  const cameraButton=useRef<HTMLButtonElement>(null),pickerHeading=useRef<HTMLHeadingElement>(null);
  const video=useRef<HTMLVideoElement>(null),controls=useRef<{stop:()=>void}|null>(null),locked=useRef(false),alive=useRef(true),cameraGeneration=useRef(0);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;cameraGeneration.current++;controls.current?.stop();};},[]);
  useEffect(()=>{if(result||error)feedback.current?.scrollIntoView({block:"nearest"});},[result,error]);
  useEffect(()=>{if(choosingEvent)pickerHeading.current?.focus();},[choosingEvent]);
  useEffect(()=>{if(selectedEventId&&!showEventPicker)cameraButton.current?.focus();},[selectedEventId,showEventPicker]);
  function stop(){cameraGeneration.current++;controls.current?.stop();controls.current=null;setCamera(false);}
  async function scan(qr:string){
    if(locked.current||!eventId)return;
    locked.current=true;stop();setBusy(true);setError("");setResult(null);setErrorKind("scan");
    try{
      const next=await send(`events/${eventId}/check-in`,"POST",{qr}) as ScanResult;
      if(next.already_checked_in)throw new Error("QR-код уже использован для входа на это мероприятие. Повторный вход запрещён");
      if(!next.admitted)throw new Error("Вход не подтверждён");
      if(alive.current){setResult(next);onScan();}
    }
    catch(reason){if(alive.current)setError((reason as Error).message);}
    finally{if(alive.current)setBusy(false);locked.current=false;}
  }
  async function startCamera(){
    setError("");setResult(null);setErrorKind("camera");
    if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia){setError("Для камеры откройте сайт по HTTPS. Можно также загрузить фотографию QR.");return;}
    const generation=++cameraGeneration.current;
    setCamera(true);
    try{
      const {BrowserQRCodeReader}=await import("@zxing/browser");
      const reader=new BrowserQRCodeReader();
      const next=await reader.decodeFromConstraints({audio:false,video:{facingMode:{ideal:"environment"}}},video.current!, (value,_error,controller)=>{if(value&&alive.current&&cameraGeneration.current===generation&&!locked.current){controller.stop();void scan(value.getText());}});
      if(!alive.current||cameraGeneration.current!==generation)next.stop();else controls.current=next;
    }catch(reason){if(alive.current&&cameraGeneration.current===generation){setCamera(false);const name=(reason as Error).name;setError(name==="NotAllowedError"?"Разрешите доступ к камере или загрузите QR с фотографии.":"Не удалось открыть камеру. Попробуйте загрузить QR с фотографии.");}}
  }
  async function readImage(file:File){
    setError("");setResult(null);setErrorKind("image");setBusy(true);const url=URL.createObjectURL(file);
    try{
      const {BrowserQRCodeReader}=await import("@zxing/browser");
      let value;
      try{value=await new BrowserQRCodeReader().decodeFromImageUrl(url);}
      catch{
        // Retry clean QR screenshots through the decoder's pure-barcode path.
        const {DecodeHintType}=await import("@zxing/library");
        value=await new BrowserQRCodeReader(new Map([[DecodeHintType.PURE_BARCODE,true]])).decodeFromImageUrl(url);
      }
      if(!alive.current)return;setBusy(false);await scan(value.getText());
    }
    catch{if(alive.current){setError("QR-код не найден на изображении. Выберите чёткую фотографию кода целиком.");setBusy(false);}}finally{URL.revokeObjectURL(url);}
  }
  if(!event&&!events.length)return <div className="quiet-empty"><span className="empty-symbol"><ScanLine size={28}/></span><h2>Сначала создайте событие</h2><p>У каждого события свой список участников. После создания здесь появится его сканер.</p><a className="button primary" href="#organizer">К моим событиям</a></div>;
  return <section className="scanner-panel" aria-label="Сканер участников" aria-busy={busy}>
    {showEventPicker?<div className="scanner-event-picker">
      <h2 ref={pickerHeading} tabIndex={-1}>На какое событие проверяем вход?</h2>
      <p>Нажмите на событие. Затем отсканируйте QR участника.</p>
      {events.length>5&&<label className="scanner-event-search"><Search size={18} aria-hidden="true"/><input type="search" aria-label="Найти событие для проверки входа" placeholder="Название события или место" value={query} onChange={e=>setQuery(e.target.value)}/></label>}
      <ul className="scanner-event-list" aria-label="Ваши события">
        {visibleEvents.map(e=><li key={e.id}><button type="button" className="scanner-event-choice" aria-pressed={e.id===eventId} onClick={()=>{stop();setSelectedEventId(e.id);setChoosingEvent(false);setQuery("");setError("");setResult(null);}}>
          <span><strong>{e.title}</strong><span>{dateLabel(e.starts_at,{year:"numeric"})} · {timeLabel(e.starts_at)} МСК</span>{(e.venue||e.city)&&<small>{[e.city,e.venue].filter(Boolean).join(" · ")}</small>}</span>
          {e.id===eventId?<Check size={20} aria-hidden="true"/>:<ArrowRight size={20} aria-hidden="true"/>}
        </button></li>)}
      </ul>
      {!visibleEvents.length&&<p role="status">События не найдены. Попробуйте другое название.</p>}
    </div>:<>
    {!event&&selectedEvent&&<div className="scanner-event-context">
      <span className="scanner-context-label"><Check size={16} aria-hidden="true"/>Проверяем вход на событие</span>
      <strong>{selectedEvent.title}</strong>
      <span className="scanner-context-date">{dateLabel(selectedEvent.starts_at,{year:"numeric"})} · {timeLabel(selectedEvent.starts_at)} МСК</span>
      {events.length>1&&<button type="button" className="scanner-change-event" disabled={busy||camera} onClick={()=>{setChoosingEvent(true);setError("");setResult(null);}}>Сменить событие</button>}
    </div>}
    {!result&&<div className="scanner-buttons"><button ref={cameraButton} className="button primary" onClick={()=>void startCamera()} disabled={!eventId||busy||camera}><Camera size={19}/>{camera?"Камера включена":"Включить камеру"}</button><label className={`button secondary image-upload ${!eventId||busy||camera?"disabled":""}`}><ImagePlus size={19}/>Загрузить QR<input aria-label="Загрузить фотографию QR" type="file" accept="image/*" disabled={!eventId||busy||camera} onChange={e=>{const file=e.target.files?.[0];if(file)void readImage(file);e.target.value="";}}/></label></div>}
    <div className={`camera-view ${camera?"camera-active":""}`} hidden={!!result}><video ref={video} playsInline muted aria-label="Изображение с камеры для сканирования QR"/>{!camera&&<div className="camera-placeholder"><ScanLine size={48} strokeWidth={1.25}/><h2>Сканируйте QR участника</h2><p>Включите камеру и наведите её на QR из профиля участника</p></div>}{camera&&<><div className="scan-frame"/><button className="camera-stop icon-button" onClick={stop} aria-label="Остановить камеру"><X size={20}/></button></>}</div>
    {busy&&<div className="scan-progress" role="status"><LoaderCircle className="spin" size={20}/>Проверяем регистрацию…</div>}
    <div ref={feedback}>
      {result&&<div className="scan-result scan-approved" role="status"><span className="result-icon"><Check size={26}/></span><div><h2>Вход подтверждён</h2><p>Регистрация на это событие найдена · {timeLabel(result.checked_in_at)}</p></div><div className="scanned-profile"><h3>{result.attendee.name}</h3><ParticipantDetails data={result.attendee.profile_data}/>{result.attendee.activities.length>0&&<p>Программа: {result.attendee.activities.join(", ")}</p>}</div></div>}
      {error&&<div className="scan-result scan-rejected" role="alert"><span className="result-icon"><X size={26}/></span><div><h2>{errorKind==="camera"?"Камера недоступна":errorKind==="image"?"QR не распознан":"Вход не подтверждён"}</h2><p>{error}</p></div></div>}
    </div>
    {(result||error)&&<button className="button primary next-scan" onClick={()=>{setResult(null);setError("");void startCamera();}} disabled={!eventId||busy}><RotateCcw size={18}/>{error&&errorKind!=="scan"?"Попробовать камеру":"Следующий участник"}</button>}
    <details className="manual-scan"><summary>Проверить по ссылке</summary><form onSubmit={e=>{e.preventDefault();void scan(manual);}}><label>Ссылка или код из QR<input value={manual} onChange={e=>setManual(e.target.value)} required placeholder="Вставьте ссылку участника"/></label><button className="button secondary" disabled={!eventId||busy}>Проверить и отметить</button></form></details>
    </>}
  </section>;
}
