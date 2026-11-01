import { useEffect, useState } from "react";
import { BellRing } from "lucide-react";
import { FormError, type Send } from "./forms";

type Config = { configured: boolean; ready: boolean; publicKey: string; deviceEnabled: boolean };
export function PushSettings({ send }: { send: Send }) {
  const supported = typeof window !== "undefined" && window.isSecureContext && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const [config, setConfig] = useState<Config | null>(null);
  const [permission, setPermission] = useState(supported ? Notification.permission : "default");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [status, setStatus] = useState("");
  useEffect(() => {
    if (!supported) return;
    let current = true;
    void send("push/config", "GET").then(value => { if (current) setConfig(value as Config); }).catch(() => { if (current) setError("Не удалось проверить push. Обновите страницу, чтобы повторить."); });
    return () => { current = false; };
  }, [send, supported]);
  async function change() {
    if (busy || !config) return;
    setBusy(true); setError(""); setStatus("");
    try {
      if (config.deviceEnabled) {
        await send("push/unsubscribe", "POST", {});
        setConfig({ ...config, deviceEnabled: false });
        const registration = await navigator.serviceWorker.getRegistration("/");
        await (await registration?.pushManager.getSubscription())?.unsubscribe().catch(() => false);
        setStatus("Push на этом устройстве отключены. История на сайте сохраняется.");
      } else {
        // The permission prompt is only triggered by this explicit click.
        const result = await Notification.requestPermission(); setPermission(result);
        if (result !== "granted") { setStatus(result === "denied" ? "Разрешите уведомления в настройках этого сайта в браузере." : "Разрешение не выдано. Можно включить позже."); return; }
        const registration = await navigator.serviceWorker.register("/push-sw.js", { scope: "/", updateViaCache: "none" });
        await navigator.serviceWorker.ready;
        const raw = atob(config.publicKey.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - config.publicKey.length % 4) % 4));
        const key = Uint8Array.from(raw, char => char.charCodeAt(0));
        let subscription = await registration.pushManager.getSubscription();
        const previousKey = subscription?.options.applicationServerKey;
        if (subscription && (!previousKey || previousKey.byteLength !== key.length || new Uint8Array(previousKey).some((byte, index) => byte !== key[index]))) {
          await subscription.unsubscribe(); subscription = null;
        }
        subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
        await send("push/subscriptions", "POST", subscription.toJSON());
        setConfig({ ...config, deviceEnabled: true });
        setStatus("Подключено. Первое уведомление уже в очереди отправки.");
      }
    } catch {
      setError("Не удалось подключить push-сервис браузера. Проверьте разрешение и соединение, затем повторите. Уведомления на сайте доступны.");
    } finally { setBusy(false); }
  }
  async function test() {
    setBusy(true); setError("");
    try { await send("push/test", "POST", {}); setStatus("Тест отправлен в очередь. Доставка обычно занимает несколько секунд; проверьте также настройки уведомлений системы."); }
    catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }
  return <section className="push-settings" aria-labelledby="push-settings-title">
    <BellRing size={22} aria-hidden="true" />
    <div><h2 id="push-settings-title">Уведомления в браузере</h2>
      <p>{!supported ? "На этом браузере push недоступны. На iPhone добавьте сайт на экран «Домой» и откройте его оттуда. Все сообщения остаются на сайте." : config?.deviceEnabled ? "Подключены на этом устройстве. Сообщим о переносах, записях, эфирах и начале мероприятий, даже когда вкладка закрыта." : permission === "denied" ? "Уведомления заблокированы. Разрешите их в настройках сайта в браузере, затем включите здесь." : "Переносы, записи и напоминания — даже при закрытой вкладке. Включаются отдельно на каждом устройстве."}</p>
      {supported && config && !config.configured && <p role="status">Push-сервис временно недоступен. Сообщения на сайте сохраняются.</p>}
      {supported && config?.configured && !config.ready && <p role="status">Доставка временно задерживается. Сообщения сохраняются в очереди.</p>}
      <FormError error={error} />{status && <p role="status">{status}</p>}
      {supported && config?.configured && <div className="push-actions">
        <button className={`button ${config.deviceEnabled ? "secondary" : "primary"}`} disabled={busy} onClick={() => void change()}>{busy ? "Подождите…" : config.deviceEnabled ? "Отключить на устройстве" : "Включить push"}</button>
        {config.deviceEnabled && <button className="text-button" disabled={busy} onClick={() => void test()}>Проверить доставку</button>}
      </div>}
    </div>
  </section>;
}
