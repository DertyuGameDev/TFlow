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
type Scope = { purpose: "scan" | "webinar"; event: FlowEvent; activity: Activity | null; expires_at: number };

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
    <header className="management-section-heading"><div><h2><KeyRound size={20}/> Доступ доверенным лицам</h2><p>Передайте сканер мероприятия или ведение отдельного онлайн-флоу.</p></div>
      <button className="button secondary small-button" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Скрыть" : "Управлять ключами"}</button>
    </header>
    {open && <>
      <p className="access-key-help">Ключ открывает только указанное действие. Доверенное лицо входит в свой аккаунт и выбирает в меню аватара «Доступ по ключу». Передайте ему ключ вручную. Он показывается только после создания; перевыпуск отключает прежний ключ.</p>
      <FormError error={error}/>
      {data ? <ul className="access-key-list">
        {row("Сканер всего мероприятия", "scan", null, data.scan_key)}
        {data.activities.map((activity) => row(`Ведущий: ${activity.title}`, "webinar", activity.id, activity.key))}
      </ul> : !error && <p role="status">Загружаем ключи…</p>}
    </>}
  </section>;
}

export function KeyAccessPage({ user, send }: { user: UserIdentity | null; send: Send }) {
  const [draft, setDraft] = useState(""), [credential, setCredential] = useState("");
  const [scope, setScope] = useState<Scope | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
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
      return send("access-keys/webinar", "POST", { key: credential, operation: method === "GET" ? "status" : (body as { operation: string }).operation });
    return Promise.reject(new Error("Действие недоступно по этому ключу"));
  }, [send, scope, credential]);
  return <section className="key-access-page" aria-label="Доступ по ключу">
    <h1>Доступ по ключу</h1>
    {!scope ? <>
      <p>Организатор может передать вам сканер мероприятия или студию одного онлайн-флоу. Ваша роль и остальные права сохраняются.</p>
      {!user ? <a className="button primary" href="/login/?next=%2F%23access">Войти в свой аккаунт</a> : <form className="flow-form" onSubmit={(e) => void open(e)}>
        <label>Ключ доступа<input type="password" value={draft} onChange={(e) => setDraft(e.target.value)} required autoComplete="off" spellCheck={false}/></label>
        <FormError error={error}/><button className="button primary" disabled={busy}>{busy ? "Проверяем…" : "Открыть доступ"}</button>
      </form>}
    </> : <>
      <header className="key-access-context"><div><h2>{scope.activity?.title ?? scope.event.title}</h2>
        <p>{scope.purpose === "scan" ? "Сканер мероприятия" : `Ведущий онлайн-флоу · ${scope.event.title}`} · до {dateLabel(scope.expires_at)} {timeLabel(scope.expires_at)} МСК</p></div>
        <button className="button secondary small-button" onClick={() => { setScope(null); setCredential(""); setError(""); }}><X size={16}/>Закрыть доступ</button>
      </header>
      {scope.purpose === "scan" ? <QRScanner event={scope.event} events={[]} endpoint="access-keys/check-in" send={delegatedSend} onScan={() => {}}/>
        : user && scope.activity && <><p className="access-key-help">Вы можете вести только этот флоу. Для входа в другом браузере откройте «Доступ по ключу» и введите тот же ключ.</p>
          <Suspense fallback={<p role="status">Открываем студию…</p>}><Webinar key={credential} event={scope.event} activity={scope.activity} user={user} send={delegatedSend} delegated/></Suspense></>}
    </>}
  </section>;
}
