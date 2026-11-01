import { useEffect } from "react";
import type { Bootstrap, Notice } from "../../lib/types";
import type { Dispatch, SetStateAction } from "react";
import type { Send } from "./forms";

export function useNotificationUpdates(userId: string | undefined, send: Send, setData: Dispatch<SetStateAction<Bootstrap>>) {
  useEffect(() => {
    if (!userId) return;
    let stopped = false, pending = false;
    async function update() {
      if (stopped || pending || document.visibilityState === "hidden") return;
      pending = true;
      try {
        const next = await send("notifications/summary", "GET") as { latest: Notice | null; unread_count: number };
        if (!stopped) setData(previous => {
          if (previous.unread_notification_count === next.unread_count && previous.notifications[0]?.id === next.latest?.id) return previous;
          return { ...previous, unread_notification_count: next.unread_count,
            notifications: next.latest ? [next.latest, ...previous.notifications.filter(item => item.id !== next.latest!.id)].slice(0, 50) : [] };
        });
      } catch { /* A temporary poll failure must not replace current content. */ }
      finally { pending = false; }
    }
    const message = (event: MessageEvent) => { if (event.data?.type === "tflow-notifications-changed") void update(); };
    const refresh = () => { void update(); };
    const timer = window.setInterval(refresh, 5000);
    window.addEventListener("focus", refresh); document.addEventListener("visibilitychange", refresh);
    navigator.serviceWorker?.addEventListener("message", message);
    void update();
    return () => { stopped = true; clearInterval(timer); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); navigator.serviceWorker?.removeEventListener("message", message); };
  }, [userId, send, setData]);
}
