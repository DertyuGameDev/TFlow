import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { TFlow } from "../app/tflow";
import type { UserIdentity } from "../lib/types";
import "../app/globals.css";
import "../app/responsive.css";
import "../app/flow.css";

function App() {
  const [session, setSession] = useState<{user: UserIdentity | null} | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/auth/me", { signal: controller.signal, credentials: "same-origin" })
      .then(async response => { if (!response.ok) throw new Error("Сервер недоступен"); return response.json(); })
      .then(setSession).catch(reason => { if (reason.name !== "AbortError") setError(reason.message); });
    return () => controller.abort();
  }, []);
  if (error) return <main className="connection-error"><h1>Не удалось подключиться к серверу</h1><p>Убедитесь, что Django запущен, и обновите страницу.</p><button className="button primary" onClick={() => window.location.reload()}>Повторить</button></main>;
  if (!session) return <main className="loading-state" role="status">Подключаемся к ТФлоу…</main>;
  return <TFlow user={session.user} onUserChange={user => setSession({user})} />;
}

createRoot(document.getElementById("root")!).render(<App />);
