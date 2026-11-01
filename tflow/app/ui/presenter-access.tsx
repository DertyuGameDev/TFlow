import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import type { Activity, FlowEvent, UserIdentity } from "../../lib/types";
import { FormError, type Send } from "./forms";
const Webinar = lazy(() => import("./webinar"));

type Scope = { purpose: "webinar"; event: FlowEvent; activity: Activity };

export function PresenterAccess({ user, send, invitation, studio = false }: {
  user: UserIdentity | null; send: Send; invitation?: string; studio?: boolean;
}) {
  const [scope, setScope] = useState<Scope | null>(null);
  const [credential, setCredential] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => {
    let token = invitation || "";
    try {
      if (invitation) sessionStorage.setItem("tflow-lecture-invite", invitation);
      token ||= sessionStorage.getItem("tflow-lecture-invite") || "";
    } catch { /* A direct invitation remains usable without storage. */ }
    if (invitation) history.replaceState(null, "", studio ? "/#presenter" : "/#lecture");
    if (!token || !user) return;
    let current = true;
    setBusy(true); setError("");
    void send("access-keys/resolve", "POST", { key: token }).then(value => {
      if (!current) return;
      const next = value as Scope;
      if (next.purpose !== "webinar" || !next.activity) throw new Error("Нужна ссылка лектора на онлайн-активность.");
      setCredential(token); setScope(next);
    }).catch(cause => { if (current) setError(cause.message); })
      .finally(() => { if (current) setBusy(false); });
    return () => { current = false; };
  }, [invitation, studio, user?.userId, send]);
  const delegatedSend = useCallback<Send>((path, method, body) => {
    if (scope && path === `activities/${scope.activity.id}/webinar`) {
      const values = body as { operation?: string; session?: string } | undefined;
      return send("access-keys/webinar", "POST", {
        key: credential, operation: method === "GET" ? "status" : values?.operation,
        ...(values?.session ? { session: values.session } : {}),
      });
    }
    return Promise.reject(new Error("По этой ссылке доступен только эфир вашей активности."));
  }, [send, scope, credential]);
  return <section className="key-access-page" aria-label="Доступ лектора">
    {!scope && <>
      <h1>Студия лектора</h1>
      <p>Персональная ссылка даёт доступ к эфиру вашей активности. Начать можно в назначенное время.</p>
      <FormError error={error} />
      {!user ? <a className="button primary" href={studio ? "/login/?next=%2F%23presenter" : "/login/?next=%2F%23lecture"}>Войти в свой аккаунт</a>
        : busy ? <p role="status">Проверяем ссылку…</p>
          : !error && <p>Откройте персональную ссылку, которую прислал организатор.</p>}
    </>}
    {scope && user && <Suspense fallback={<p role="status">Открываем студию…</p>}>
      <Webinar key={credential} event={scope.event} activity={scope.activity} user={user} send={delegatedSend} studio={studio} delegated broadcastAccessKey={credential} />
    </Suspense>}
  </section>;
}
