/* No fetch/cache handler: private pages and API responses are never cached here. */
self.addEventListener("install", event => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
self.addEventListener("push", event => {
  event.waitUntil((async () => {
    let notice;
    try {
      const id = event.data.json().noticeId;
      if (typeof id !== "string" || id.length > 100) throw new Error("invalid notice");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 7000);
      try {
        const response = await fetch("/api/notifications/" + encodeURIComponent(id), {
          credentials: "same-origin", cache: "no-store", redirect: "error", signal: controller.signal,
        });
        if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) throw new Error("not signed in");
        notice = await response.json();
      } finally { clearTimeout(timer); }
    } catch { /* CU or the application session may have expired: do not expose old account data. */ }
    const url = notice?.event_id
      ? "/#event/" + encodeURIComponent(notice.event_id) + (notice.activity_id ? "/" + encodeURIComponent(notice.activity_id) : "")
      : "/#notifications";
    await self.registration.showNotification(notice?.title || "ТФлоу · Новое уведомление", {
      body: notice?.message || "Войдите в аккаунт, чтобы прочитать новые уведомления.",
      icon: "/push-icon-192.png", badge: "/push-icon-192.png", tag: notice?.id || "tflow-sign-in",
      renotify: false, data: { url },
    });
    for (const client of await self.clients.matchAll({ type: "window" })) client.postMessage({ type: "tflow-notifications-changed" });
  })());
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil((async () => {
    const target = new URL(event.notification.data?.url || "/#notifications", self.location.origin);
    if (target.origin !== self.location.origin) return;
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const client = windows.find(client => new URL(client.url).origin === target.origin);
    if (client) { await client.navigate(target.href); await client.focus(); }
    else await self.clients.openWindow(target.href);
  })());
});
