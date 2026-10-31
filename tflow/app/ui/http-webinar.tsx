import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import { Mic, MicOff, MonitorUp, Video, VideoOff, Send as SendIcon, Square, Play, LogOut } from "lucide-react";
import type { Activity, FlowEvent } from "../../lib/types";
import { BroadcastCapture, BroadcastUpload, broadcastRequest, recordingMime } from "../../lib/http-broadcast";
import { dateLabel, timeLabel } from "../../lib/time";
import { FormError } from "./forms";
import { Modal } from "./dialog";
import "../http-webinar.css";

export type HttpStatus = { host: boolean; active: boolean; configured: boolean; session: string | null; ready?: boolean;
  starts_at?: string; scheduled?: boolean; can_start?: boolean; playlist?: string | null; ended: boolean; published: boolean; failure?: string; configuration_error?: string };
type Message = { id: string; author: string; text: string; own: boolean };

export default function HttpWebinar({ event, activity, initialStatus, accessKey }: {
  event: FlowEvent; activity?: Activity; initialStatus: HttpStatus; accessKey?: string;
}) {
  const endpoint = `${activity ? "activities/" + activity.id : "events/" + event.id}/broadcast`;
  const [status, setStatus] = useState(initialStatus), [error, setError] = useState("");
  const [busy, setBusy] = useState(false), [deviceBusy, setDeviceBusy] = useState(false), [publishing, setPublishing] = useState(false);
  const [joined, setJoined] = useState(false), [confirmEnd, setConfirmEnd] = useState(false), [audioHelp, setAudioHelp] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]), [draft, setDraft] = useState(""), [chatBusy, setChatBusy] = useState(false);
  const [devices, setDevices] = useState({ microphone: false, camera: false, screen: false });
  const canvas = useRef<HTMLCanvasElement>(null), video = useRef<HTMLVideoElement>(null);
  const capture = useRef<BroadcastCapture | null>(null), upload = useRef<BroadcastUpload | null>(null);
  const ownSession = useRef<string | null>(null), alive = useRef(true), starting = useRef(false), pollBusy = useRef(false);
  const hls = useRef<Hls | null>(null);
  const scheduled = status.scheduled === true;
  const startAt = status.starts_at ? Date.parse(status.starts_at) : Math.max(event.starts_at, activity?.starts_at ?? event.starts_at);
  const startLabel = `${dateLabel(startAt)} в ${timeLabel(startAt)} МСК`;
  const screenSupported = !!navigator.mediaDevices?.getDisplayMedia;
  const request = <T,>(path: string, options?: RequestInit) => broadcastRequest<T>(path, options, accessKey);
  const post = <T,>(path: string, data: object) => request<T>(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
  function releaseDevices() {
    upload.current?.stop(); upload.current = null;
    capture.current?.dispose(); capture.current = null;
    if (alive.current) { setPublishing(false); setDevices({ microphone: false, camera: false, screen: false }); }
  }
  function stopOwn() {
    const session = ownSession.current; ownSession.current = null; releaseDevices();
    if (session) void post(endpoint, { operation: "end", session }).catch(() => {});
  }
  async function refresh() {
    if (starting.current || pollBusy.current) return;
    pollBusy.current = true;
    try {
      const next = await request<HttpStatus>(endpoint);
      if (!alive.current) return;
      setStatus(next);
      if (ownSession.current && (ownSession.current !== next.session || !next.active || next.ended)) {
        ownSession.current = null; releaseDevices(); setError("Эфир остановлен. Можно запустить новый.");
      }
      if (!next.active || next.ended) { setJoined(false); video.current?.pause(); hls.current?.destroy(); hls.current = null; }
    } catch (cause) {
      if (!alive.current) return;
      setError((cause as Error).message);
      if ([401, 403, 404].includes((cause as { status?: number }).status ?? 0)) {
        ownSession.current = null; releaseDevices(); setJoined(false);
        hls.current?.destroy(); hls.current = null; video.current?.pause();
        setStatus(previous => ({ ...previous, active: false, configured: false }));
      }
    } finally { pollBusy.current = false; }
  }
  useEffect(() => {
    alive.current = true; void refresh();
    const timer = setInterval(() => void refresh(), 2500);
    const exit = () => { upload.current?.stop(); capture.current?.dispose(); };
    window.addEventListener("pagehide", exit);
    return () => {
      alive.current = false; clearInterval(timer); window.removeEventListener("pagehide", exit);
      stopOwn(); hls.current?.destroy(); hls.current = null;
    };
  }, [endpoint, accessKey]);
  useEffect(() => {
    if (!status.active || !status.session) { setMessages([]); return; }
    let canceled = false, pending = false;
    async function load() {
      if (pending) return; pending = true;
      try {
        const result = await request<{ messages: Message[] }>(`broadcasts/${status.session}/chat`);
        if (!canceled) setMessages(result.messages);
      } catch { /* Access and stream lifecycle are checked by the status poll. */ }
      finally { pending = false; }
    }
    void load(); const timer = setInterval(() => void load(), 2000);
    return () => { canceled = true; clearInterval(timer); };
  }, [status.active, status.session, accessKey]);
  useEffect(() => {
    const element = video.current;
    if (!element || !joined || !status.ready || !status.playlist) return;
    let disposed = false;
    const play = () => { void element.play().catch(() => { if (!disposed) setAudioHelp(true); }); };
    if (element.canPlayType("application/vnd.apple.mpegurl")) {
      element.src = status.playlist; element.addEventListener("loadedmetadata", play); play();
    } else if (Hls.isSupported()) {
      const player = new Hls({ backBufferLength: 2, maxBufferLength: 8, liveSyncDurationCount: 2,
        xhrSetup: xhr => { xhr.withCredentials = true; if (accessKey) xhr.setRequestHeader("X-TFlow-Access-Key", accessKey); } });
      hls.current = player; player.attachMedia(element); player.loadSource(status.playlist);
      player.on(Hls.Events.MANIFEST_PARSED, play);
      player.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal && !disposed) setError("Передача прервалась. Нажмите «Выйти из просмотра» и подключитесь снова.");
      });
    } else setError("Браузер не поддерживает прямые трансляции. Откройте комнату в Chrome или Safari.");
    return () => { disposed = true; element.removeEventListener("loadedmetadata", play); hls.current?.destroy(); hls.current = null; element.pause(); element.removeAttribute("src"); element.load(); };
  }, [joined, status.session, status.ready, status.playlist, accessKey]);
  function getCapture() {
    if (!capture.current) {
      if (!canvas.current || !navigator.mediaDevices || !window.isSecureContext) throw new Error("Откройте студию в обычном браузере по HTTPS.");
      capture.current = new BroadcastCapture(canvas.current, () => {
        if (alive.current && capture.current) setDevices({ microphone: capture.current.microphoneEnabled, camera: capture.current.cameraEnabled, screen: capture.current.screenEnabled });
      });
    }
    return capture.current;
  }
  async function device(kind: keyof typeof devices) {
    if (deviceBusy) return;
    setDeviceBusy(true); setError("");
    try {
      const current = getCapture();
      if (kind === "microphone") await current.microphoneInput(!devices.microphone);
      else await current.video(kind, !devices[kind]);
    } catch (cause) {
      if (alive.current) {
        const name = (cause as Error).name;
        setError(name === "NotAllowedError" ? "Доступ не разрешён или выбор отменён. Нажмите кнопку ещё раз и разрешите нужное устройство."
          : name === "NotFoundError" ? "Нужное устройство не найдено. Проверьте подключение камеры или микрофона."
          : name === "NotReadableError" ? "Устройство занято другим приложением. Освободите его и попробуйте ещё раз."
          : (cause as Error).message);
      }
    } finally { if (alive.current) setDeviceBusy(false); }
  }
  async function start() {
    if (starting.current || scheduled || status.can_start === false) return;
    starting.current = true; setBusy(true); setError("");
    try {
      const current = getCapture(), mime = recordingMime().split(";")[0];
      const result = await post<{ session: string; publisher: string }>(endpoint, { operation: "start", mime });
      if (!alive.current) { void post(endpoint, { operation: "end", session: result.session }).catch(() => {}); current.dispose(); return; }
      ownSession.current = result.session;
      upload.current = new BroadcastUpload(current.stream, result.session, result.publisher, message => { stopOwn(); if (alive.current) { setError(message); void refresh(); } }, accessKey);
      setPublishing(true); setStatus(previous => ({ ...previous, active: true, session: result.session, ready: false }));
    } catch (cause) { stopOwn(); if (alive.current) setError((cause as Error).message); }
    finally { starting.current = false; if (alive.current) { setBusy(false); void refresh(); } }
  }
  async function end() {
    setBusy(true); setError("");
    try {
      await post(endpoint, { operation: "end", session: status.session });
      ownSession.current = null; releaseDevices(); setConfirmEnd(false); await refresh();
    } catch (cause) { setError((cause as Error).message); }
    finally { if (alive.current) setBusy(false); }
  }
  async function chat(event: React.FormEvent) {
    event.preventDefault(); if (!draft.trim() || chatBusy || !status.session) return;
    setChatBusy(true);
    try {
      const data = await post<{ messages: Message[] }>(`broadcasts/${status.session}/chat`, { text: draft.trim() });
      if (alive.current) { setMessages(data.messages); setDraft(""); }
    } catch (cause) { if (alive.current) setError((cause as Error).message); }
    finally { if (alive.current) setChatBusy(false); }
  }
  return <section className="webinar-shell http-webinar" aria-label={status.host ? "Студия трансляции" : "Просмотр трансляции"}>
    <header className="http-webinar-heading"><div><h2>{activity?.title ?? "Прямой эфир"}</h2>
      <p>{status.active ? (status.ready ? "В эфире" : "Готовим трансляцию…") : status.ended ? "Мероприятие завершено" : scheduled ? `Начало ${startLabel}` : status.host ? "Подготовьте камеру и микрофон" : "Ведущий ещё не начал эфир"}</p></div>
      <span className="http-webinar-badge">{publishing ? "● Вы в эфире" : "Трансляция"}</span></header>
    {scheduled && <p className="http-webinar-schedule" id="broadcast-schedule">Эфир начнётся {startLabel}. {status.host ? "До начала можно проверить камеру, микрофон и показ экрана. Кнопка запуска станет доступна автоматически." : "Когда ведущий начнёт трансляцию, появится возможность подключиться."}</p>}
    <p className="http-webinar-delay">Звук и видео идут с небольшой задержкой. Вопросы можно задавать в чате.</p>
    <FormError error={error}/>
    {!status.configured && <p role="status">{status.configuration_error}</p>}
    <div className="webinar-layout"><div className="webinar-video-area">
      <div className="webinar-stage http-webinar-stage">
        {status.host ? <canvas ref={canvas} aria-label="Предпросмотр камеры или экрана"/> : <>
          <video ref={video} controls playsInline aria-label="Видео и звук ведущего" hidden={!joined}/>
          {!joined && <p>{status.active ? "Подключитесь, чтобы смотреть эфир" : "Здесь появится трансляция ведущего"}</p>}
          {joined && !status.ready && <p role="status">Подготавливаем видео. Обычно это занимает несколько секунд…</p>}
        </>}
      </div>
      {audioHelp && joined && <button className="button secondary" onClick={() => void video.current?.play().then(() => setAudioHelp(false)).catch(() => setError("Нажмите кнопку воспроизведения в самом видео."))}>Включить звук и видео</button>}
      <div className="webinar-controls">
        {status.host ? <>
          <button className="button secondary" aria-pressed={devices.microphone} disabled={deviceBusy} onClick={() => void device("microphone")}>{devices.microphone ? <Mic/> : <MicOff/>}{devices.microphone ? "Выключить микрофон" : "Включить микрофон"}</button>
          <button className="button secondary" aria-pressed={devices.camera} disabled={deviceBusy} onClick={() => void device("camera")}>{devices.camera ? <Video/> : <VideoOff/>}{devices.camera ? "Выключить камеру" : "Включить камеру"}</button>
          <button className="button secondary" aria-pressed={devices.screen} disabled={deviceBusy || !screenSupported} onClick={() => void device("screen")}><MonitorUp/>{devices.screen ? "Остановить показ" : "Показать экран"}</button>
          {!status.active ? <button className="button primary" aria-describedby={scheduled ? "broadcast-schedule" : undefined} disabled={busy || !status.configured || status.ended || !status.published || scheduled || status.can_start === false} onClick={() => void start()}><Play/>{busy ? "Запускаем…" : "Начать эфир"}</button>
            : <button className="button danger-outline" disabled={busy} onClick={() => setConfirmEnd(true)}><Square/>Завершить эфир</button>}
        </> : joined ? <button className="button secondary" onClick={() => { setJoined(false); setAudioHelp(false); }}><LogOut/>Выйти из просмотра</button>
          : <button className="button primary" disabled={!status.active || status.ended} onClick={() => { setError(""); setJoined(true); }}><Play/>Смотреть эфир</button>}
      </div>
      {status.host && <p className="http-webinar-help">Сначала включите нужные устройства, затем начните эфир. При показе экрана голос передаётся через микрофон. Камера и микрофон изначально выключены.</p>}
      {status.host && !screenSupported && <p className="http-webinar-help">Для показа экрана откройте студию в браузере на компьютере.</p>}
    </div><aside className="webinar-chat"><h3>Чат эфира</h3>
      <div className="webinar-messages" role="log" aria-label="Сообщения эфира" aria-live="polite">
        {messages.length ? messages.map(message => <div className={`webinar-message ${message.own ? "own" : ""}`} key={message.id}><strong>{message.author}</strong><p>{message.text}</p></div>) : <p className="webinar-chat-empty">Вопросы ведущему и сообщения участников появятся здесь.</p>}
      </div>
      <form onSubmit={event => void chat(event)}><label><span className="sr-only">Сообщение в чат</span><textarea rows={2} maxLength={1000} value={draft} disabled={!status.active} onChange={event => setDraft(event.target.value)} placeholder="Ваш вопрос или сообщение"/></label>
        <button className="button primary" disabled={!status.active || chatBusy || !draft.trim()}><SendIcon size={16}/>Отправить</button></form>
    </aside></div>
    {confirmEnd && <Modal title="Завершить эфир для всех?" dismissible={!busy} onClose={() => setConfirmEnd(false)}>
      <p className="confirmation-copy">Звук и видео остановятся у зрителей. Позже можно начать новый эфир.</p><FormError error={error}/>
      <div className="confirmation-actions"><button className="button secondary" disabled={busy} onClick={() => setConfirmEnd(false)}>Продолжить эфир</button><button className="button danger-button" disabled={busy} onClick={() => void end()}>{busy ? "Завершаем…" : "Да, завершить эфир"}</button></div>
    </Modal>}
  </section>;
}
