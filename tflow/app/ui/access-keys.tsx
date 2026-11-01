import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Copy, KeyRound, ScanLine, Video, X } from "lucide-react";
import type { Activity, FlowEvent, UserIdentity } from "../../lib/types";
import { dateLabel, timeLabel } from "../../lib/time";
import { FormError, type Send } from "./forms";
import { QRScanner } from "./qr-scanner";
import "../access-keys.css";

const Webinar = lazy(() => import("./webinar"));
type KeyInfo = { id: string; expires_at: number; users: number };
type Keys = { scan_key: KeyInfo | null; activities: { id: string; title: string; key: KeyInfo | null }[] };
type Scope = { purpose: "scan" | "webinar"; event: FlowEvent; activity: Activity | null; expires_at: number; scan_activities?: Pick<Activity,"id"|"title">[] };

export function AccessKeyManager({ event, send }: { event: FlowEvent; send: Send }) {
  const [open, setOpen] = useState(false), [data, setData] = useState<Keys | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [revealed, setRevealed] = useState<{ target: string; key: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const sequence = useRef(0);
  const load = useCallback(async () => {
    const current = ++sequence.current;
    try {
      const next = await send(`events/${event.id}/access-keys`, "GET") as Keys;
      if (current === sequence.current) { setData(next); setError(""); }
    } catch (e) { if (current === sequence.current) setError((e as Error).message); }
  }, [event.id, send]);
  useEffect(() => { if (open) void load(); return () => { sequence.current++; }; }, [open, load]);
  async function change(purpose: "scan" | "webinar", activityId: string | null, operation: "issue" | "revoke") {
    if (busy) return;
    setBusy(true); setError(""); setCopied(false); setRevealed(null);
    try {
      const next = await send(`events/${event.id}/access-keys`, "POST", { purpose, activity_id: activityId, operation }) as { key?: string };
      if (next.key) setRevealed({ target: activityId ?? "scan", key: next.key });
      await load();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  function row(title: string, purpose: "scan" | "webinar", activityId: string | null, key: KeyInfo | null) {
    const target = activityId ?? "scan";
    return <li key={target}>
      <div><h3>{purpose === "scan" ? <ScanLine size={18}/> : <Video size={18}/>} {title}</h3>
        <p>{key ? `Действует до ${dateLabel(key.expires_at)} · ${timeLabel(key.expires_at)} МСК. Использовали: ${key.users}.` : "Активного ключа нет"}</p>
      </div>
      <div className="access-key-actions">
        <button className="button secondary small-button" disabled={busy || event.ends_at <= Date.now()} onClick={() => void change(purpose, activityId, "issue")}>{key ? "Перевыпустить ключ" : "Создать ключ"}</button>
        {key && <button className="button danger-outline small-button" disabled={busy} onClick={() => void change(purpose, activityId, "revoke")}>Отозвать</button>}
      </div>
      {revealed?.target === target && <div className="access-key-revealed">
        <label>Созданный ключ<input aria-label={`Ключ: ${title}`} value={revealed.key} readOnly spellCheck={false} autoComplete="off" onFocus={(e) => e.currentTarget.select()}/></label>
        <button className="button secondary small-button" onClick={() => void navigator.clipboard.writeText(revealed.key).then(() => setCopied(true)).catch(() => setError("Выделите и скопируйте ключ из поля вручную."))}><Copy size={16}/>{copied ? "Скопировано" : "Копировать ключ"}</button>
        <button className="text-button" onClick={() => setRevealed(null)}>Скрыть ключ</button>
      </div>}
    </li>;
  }
  return <section className="access-key-manager management-card" aria-label="Доступ доверенным лицам">
    <header className="management-section-heading"><div><h2><KeyRound size={20}/> Доступ доверенным лицам</h2><p>Передайте токен сканера помощнику на входе.</p></div>
      <button className="button secondary small-button" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Скрыть" : "Управлять ключами"}</button>
    </header>
    {open && <>
      <p className="access-key-help">Помощник входит в свой аккаунт, открывает «Сканер QR» и вводит токен. Токен показывается только после создания; перевыпуск отключает прежний.</p>
      <FormError error={error}/>
      {data ? <ul className="access-key-list">
        {row("Сканер всего мероприятия", "scan", null, data.scan_key)}
      </ul> : !error && <p role="status">Загружаем ключи…</p>}
    </>}
  </section>;
}

export function KeyAccessPage({ user, send, invitation, studio = false, invitationMode = false }: { user: UserIdentity | null; send: Send; invitation?: string; studio?: boolean; invitationMode?: boolean }) {
  const [draft, setDraft] = useState(""), [credential, setCredential] = useState("");
  const [scope, setScope] = useState<Scope | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => {
    if (!invitationMode) return;
    let token = invitation || "";
    try { token ||= sessionStorage.getItem("tflow-lecture-invite") || ""; } catch { /* Direct invitation remains usable. */ }
    if (invitation) {
      try { sessionStorage.setItem("tflow-lecture-invite", invitation); } catch { setError("Разрешите хранение данных сайта, чтобы ссылка сохранилась после входа."); }
      history.replaceState(null, "", studio ? "/#presenter" : "/#lecture");
    }
    if (!token || !user) return;
    let current = true; setBusy(true);
    void send("access-keys/resolve", "POST", {key:token}).then(value => {if(current){const next=value as Scope;if(next.purpose!=="webinar")throw new Error("Нужна ссылка лектора");setCredential(token);setScope(next)}}).catch(e=>{if(current)setError(e.message)}).finally(()=>{if(current)setBusy(false)});
    return()=>{current=false};
  }, [invitation, studio, invitationMode, user?.userId, send]);
  async function open(e: React.FormEvent) {
    e.preventDefault(); if (!user || busy) return;
    setBusy(true); setError("");
    try {
      const key = draft.trim();
      const next = await send("access-keys/resolve", "POST", { key }) as Scope;
      setCredential(key); setScope(next); setDraft("");
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  const delegatedSend = useCallback<Send>((path, method, body) => {
    if (scope?.purpose === "scan" && path === "access-keys/check-in" && method === "POST")
      return send(path, method, { ...(body as object), key: credential });
    if (scope?.purpose === "webinar" && scope.activity && path === `activities/${scope.activity.id}/webinar`)
      return send("access-keys/webinar", "POST", { key: credential, operation: method === "GET" ? "status" : (body as { operation: string }).operation, ...((body as { session?: string } | undefined)?.session ? { session: (body as { session: string }).session } : {}) });
    return Promise.reject(new Error("Действие недоступно по этому ключу"));
  }, [send, scope, credential]);
  return <section className="key-access-page" aria-label="Доступ по ключу">
    {(!scope || !studio) && <h1>{scope?.purpose==="scan"?"Сканер QR":invitationMode ? (studio?"Студия лектора":"Вход лектора") : "Ввести токен"}</h1>}
    {!scope ? <>
      <p>{invitationMode?"Персональная студия привязана к вашей активности. Войдите в аккаунт, чтобы продолжить.":"Введите токен организатора — откроется сканер его мероприятия."}</p>
      {!user ? <a className="button primary" href={invitationMode ? (studio?"/login/?next=%2F%23presenter":"/login/?next=%2F%23lecture") : "/login/?next=%2F%23scan"}>Войти в свой аккаунт</a> : <form className="flow-form" onSubmit={(e) => void open(e)}>
        <label>Токен организатора<input type="password" value={draft} onChange={(e) => setDraft(e.target.value)} required autoComplete="off" spellCheck={false}/></label>
        <FormError error={error}/><button className="button primary" disabled={busy}>{busy ? "Проверяем…" : "Открыть доступ"}</button>
      </form>}
    </> : <>
      {!studio && <header className="key-access-context"><div><h2>{scope.activity?.title ?? scope.event.title}</h2>
        <p>{scope.purpose === "scan" ? `От имени организатора · ${scope.event.organizer}` : `Ведущий онлайн-флоу · ${scope.event.title}`}{!studio && <> · до {dateLabel(scope.expires_at)} {timeLabel(scope.expires_at)} МСК</>}</p></div>
        {!studio && <button className="button secondary small-button" onClick={() => { setScope(null); setCredential(""); setError(""); try { sessionStorage.removeItem("tflow-lecture-invite"); } catch { /* Already closed in this page. */ } }}><X size={16}/>Закрыть доступ</button>}
      </header>}
      {scope.purpose === "scan" ? <QRScanner event={scope.event} events={[]} simple autoStart activities={scope.scan_activities??[]} endpoint="access-keys/check-in" send={delegatedSend} onScan={() => {}}/>
        : user && scope.activity && <>{!studio && <p className="access-key-help">Вам доступен эфир этой активности. В другом браузере откройте персональную ссылку заново.</p>}
          <Suspense fallback={<p role="status">Открываем студию…</p>}><Webinar key={credential} event={scope.event} activity={scope.activity} user={user} send={delegatedSend} studio={studio} delegated broadcastAccessKey={credential}/></Suspense></>}
    </>}
  </section>;
}
