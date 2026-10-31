import { useEffect, useState } from "react";
import type { Activity, EventDetail } from "../../lib/types";
import { dateLabel, timeLabel } from "../../lib/time";
import { Modal } from "./dialog";
import { FormError, type Send } from "./forms";

type Change = { id: string; title: string; before: Range; after: Range };
type Range = { starts_at: number; ends_at: number };
type Preview = { changes: Change[] };
function label(range: Range) {
  return `${dateLabel(range.starts_at)} · ${timeLabel(range.starts_at)}–${timeLabel(range.ends_at)}`;
}

export function ProgramSwap({ activity, detail, send, onClose, refresh }: {
  activity: Activity; detail: EventDetail; send: Send;
  onClose: () => void; refresh: () => Promise<void>;
}) {
  const [otherId, setOtherId] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const version = detail.event.updated_at;
  useEffect(() => {
    let current = true;
    setPreview(null);
    setError("");
    if (!otherId) { setLoading(false); return; }
    setLoading(true);
    send(`activities/${activity.id}/swap`, "POST", {
      other_id: otherId, expected_event_updated_at: version, preview: true,
    }).then((result) => { if (current) setPreview(result as Preview); })
      .catch((cause) => { if (current) setError(cause instanceof Error ? cause.message : "Не удалось проверить обмен"); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [activity.id, otherId, version, send]);
  return <Modal title="Поменять местами" subtitle={activity.title} onClose={onClose} dismissible={!saving}>
    <form className="flow-form" onSubmit={async (e) => {
      e.preventDefault();
      if (!preview?.changes.length || saving) return;
      setSaving(true); setError("");
      try {
        await send(`activities/${activity.id}/swap`, "POST", {other_id: otherId, expected_event_updated_at: version});
        await refresh(); onClose();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Не удалось сохранить обмен");
        setPreview(null);
      } finally { setSaving(false); }
    }}>
      <label>С каким пунктом<select required value={otherId} disabled={saving} onChange={(e) => setOtherId(e.target.value)}>
        <option value="">Выберите пункт программы</option>
        {detail.activities.filter((item) => item.id !== activity.id).map((item) =>
          <option key={item.id} value={item.id}>{item.title} · {timeLabel(item.starts_at)} · {item.room_name}</option>)}
      </select></label>
      <p className="muted small">Длительность и аудитории сохранятся. В одной аудитории пункты между выбранными тоже сдвинутся, сохранив перерывы.</p>
      <div role="status">{loading ? "Проверяем расписание и записи участников…" : preview && !preview.changes.length ? "Время этих пунктов уже совпадает." : ""}</div>
      {preview && preview.changes.length > 0 && <ol className="program-swap-preview" aria-label="Изменения расписания">
        {preview.changes.map((change) => <li key={change.id}>
          <strong>{change.title}</strong>
          <span className="muted">Было: {label(change.before)}</span>
          <span>Будет: {label(change.after)} МСК</span>
        </li>)}
      </ol>}
      <FormError error={error}/>
      <div className="form-footer"><button type="button" className="button secondary" disabled={saving} onClick={onClose}>Отмена</button>
        <button className="button primary" disabled={saving || loading || !preview?.changes.length}>{saving ? "Сохраняем…" : "Подтвердить обмен"}</button></div>
    </form>
  </Modal>;
}
