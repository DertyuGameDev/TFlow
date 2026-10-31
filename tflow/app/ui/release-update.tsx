import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import "../release-update.css";
declare const __TFLOW_BUILD_ID__: string;

const currentBuild = typeof __TFLOW_BUILD_ID__ === "string" ? __TFLOW_BUILD_ID__ : "development";

export function ReleaseUpdate({ version = currentBuild, enabled = import.meta.env.PROD, reload = () => location.reload() }: {
  version?: string; enabled?: boolean; reload?: () => void;
}) {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    if (!enabled || !/^[a-f0-9]{40}$/.test(version)) return;
    let alive = true, pending = false;
    const abort = new AbortController();
    async function check() {
      if (pending || document.visibilityState === "hidden") return;
      pending = true;
      try {
        const response = await fetch("/api/version", {cache:"no-store", signal:abort.signal});
        if (!response.ok) return;
        const next = await response.json() as {id?: string};
        if (alive && next.id && /^[a-f0-9]{40}$/.test(next.id)) setAvailable(next.id !== version);
      } catch { /* Offline or expired CU login must not interrupt editing. */ }
      finally { pending = false; }
    }
    void check();
    const timer = setInterval(() => void check(), 30000);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      alive = false; abort.abort(); clearInterval(timer);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [enabled, version]);
  if (!available) return null;
  return <aside className="release-update" role="status" aria-label="Обновление приложения">
    <p><strong>Доступна новая версия</strong><span>Сохраните изменения и обновите страницу.</span></p>
    <button type="button" className="button secondary small-button" onClick={reload}><RefreshCw size={16}/>Обновить</button>
  </aside>;
}
