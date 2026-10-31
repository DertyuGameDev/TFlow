import { useEffect, useRef, useState } from "react";
import { Camera, Check, ImagePlus, LoaderCircle, RotateCcw, ScanLine, X } from "lucide-react";
import type { FlowEvent, ScanResult } from "../../lib/types";
import { timeLabel } from "../../lib/time";
import type { Send } from "./forms";
import { ParticipantDetails } from "./profile-data";

export function QRScanner({event,events,initialToken,send,onScan}:{event?:FlowEvent;events:FlowEvent[];initialToken?:string;send:Send;onScan:()=>void}) {
  const [eventId,setEventId]=useState(event?.id??""),[result,setResult]=useState<ScanResult|null>(null),[error,setError]=useState("");
  const [busy,setBusy]=useState(false),[camera,setCamera]=useState(false),[manual,setManual]=useState(initialToken??"");
  const [errorKind,setErrorKind]=useState<"scan"|"camera"|"image">("scan");
  const feedback=useRef<HTMLDivElement>(null);
  const video=useRef<HTMLVideoElement>(null),controls=useRef<{stop:()=>void}|null>(null),locked=useRef(false),alive=useRef(true),cameraGeneration=useRef(0);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;cameraGeneration.current++;controls.current?.stop();};},[]);
  useEffect(()=>{if(result||error)feedback.current?.scrollIntoView({block:"nearest"});},[result,error]);
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
    {!event&&<label className="scanner-event-label">Событие<select value={eventId} disabled={busy||camera} onChange={e=>{stop();setEventId(e.target.value);setError("");setResult(null);}}><option value="">Выберите ваше событие</option>{events.map(e=><option key={e.id} value={e.id}>{e.title}</option>)}</select></label>}
    {!eventId&&<p className="scanner-help">Выберите событие, чтобы включить камеру или загрузить QR.</p>}
    <div className={`camera-view ${camera?"camera-active":""}`} hidden={!!result}><video ref={video} playsInline muted aria-label="Изображение с камеры для сканирования QR"/>{!camera&&<div className="camera-placeholder"><ScanLine size={48} strokeWidth={1.25}/><h2>Пропуск участника</h2><p>Включите камеру и наведите её на QR из профиля участника</p></div>}{camera&&<><div className="scan-frame"/><button className="camera-stop icon-button" onClick={stop} aria-label="Остановить камеру"><X size={20}/></button></>}</div>
    {!result&&<div className="scanner-buttons"><button className="button primary" onClick={()=>void startCamera()} disabled={!eventId||busy||camera}><Camera size={19}/>{camera?"Камера включена":"Включить камеру"}</button><label className={`button secondary image-upload ${!eventId||busy||camera?"disabled":""}`}><ImagePlus size={19}/>Загрузить QR<input aria-label="Загрузить фотографию QR" type="file" accept="image/*" disabled={!eventId||busy||camera} onChange={e=>{const file=e.target.files?.[0];if(file)void readImage(file);e.target.value="";}}/></label></div>}
    {busy&&<div className="scan-progress" role="status"><LoaderCircle className="spin" size={20}/>Проверяем регистрацию…</div>}
    <div ref={feedback}>
      {result&&<div className="scan-result scan-approved" role="status"><span className="result-icon"><Check size={26}/></span><div><h2>Вход подтверждён</h2><p>Регистрация на это событие найдена · {timeLabel(result.checked_in_at)}</p></div><div className="scanned-profile"><h3>{result.attendee.name}</h3><ParticipantDetails data={result.attendee.profile_data}/>{result.attendee.activities.length>0&&<p>Программа: {result.attendee.activities.join(", ")}</p>}</div></div>}
      {error&&<div className="scan-result scan-rejected" role="alert"><span className="result-icon"><X size={26}/></span><div><h2>{errorKind==="camera"?"Камера недоступна":errorKind==="image"?"QR не распознан":"Вход не подтверждён"}</h2><p>{error}</p></div></div>}
    </div>
    {(result||error)&&<button className="button primary next-scan" onClick={()=>{setResult(null);setError("");void startCamera();}} disabled={!eventId||busy}><RotateCcw size={18}/>{error&&errorKind!=="scan"?"Попробовать камеру":"Следующий участник"}</button>}
    <details className="manual-scan"><summary>Проверить по ссылке</summary><form onSubmit={e=>{e.preventDefault();void scan(manual);}}><label>Ссылка или код из QR<input value={manual} onChange={e=>setManual(e.target.value)} required placeholder="Вставьте ссылку участника"/></label><button className="button secondary" disabled={!eventId||busy}>Проверить и отметить</button></form></details>
  </section>;
}
