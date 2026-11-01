import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Bell, Check, CheckCheck, CircleX } from "lucide-react";
import type { Notice, NoticePage } from "../../lib/types";
import { dateLabel, timeLabel } from "../../lib/time";
import { FormError, type Send } from "./forms";
import "../notifications.css";
import { PushSettings } from "./push-settings";

export function NotificationCenter({
  send,
  unreadCount,
  revision,
  onChange,
  onOpen,
}: {
  send: Send;
  unreadCount: number;
  revision: string;
  onChange: () => Promise<void>;
  onOpen: (eventId: string | null, activityId?: string | null) => void;
}) {
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [page, setPage] = useState<NoticePage>({
    items: [],
    next_cursor: null,
  });
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const sequence = useRef(0);
  const load = useCallback(
    async (before?: string, keepHistory = false) => {
      const current = ++sequence.current;
      setLoading(true);
      setError("");
      const query = new URLSearchParams();
      if (unreadOnly) query.set("unread", "1");
      if (before) query.set("before", before);
      try {
        const next = (await send(`notifications?${query}`, "GET")) as NoticePage;
        if (current !== sequence.current) return;
        setPage((previous) => ({
          items: before
            ? [
                ...new Map(
                  [...previous.items, ...next.items].map((item) => [
                    item.id,
                    item,
                  ]),
                ).values(),
              ]
            : keepHistory && next.items.some(item => previous.items.some(old => old.id === item.id))
              ? [...next.items, ...previous.items.filter(old => !next.items.some(item => item.id === old.id) && (!unreadOnly || !old.read))]
              : next.items,
          next_cursor: keepHistory && next.items.some(item => previous.items.some(old => old.id === item.id)) ? previous.next_cursor : next.next_cursor,
        }));
      } catch (cause) {
        if (current === sequence.current) setError((cause as Error).message);
      } finally {
        if (current === sequence.current) setLoading(false);
      }
    },
    [send, unreadOnly],
  );
  useEffect(() => {
    void load();
    return () => {
      sequence.current++;
    };
  }, [load]);
  const previousRevision = useRef(revision);
  useEffect(() => {
    if (previousRevision.current !== revision) {
      previousRevision.current = revision;
      void load(undefined, true);
    }
  }, [load, revision]);

  async function markRead(path: string, after?: () => void) {
    if (working) return;
    setWorking(true);
    setError("");
    try {
      await send(path, "PATCH", {});
      setPage(previous => ({ ...previous, items: previous.items.flatMap(item => {
        const read = path === "notifications" || path === `notifications/${item.id}`;
        return read && unreadOnly ? [] : [{ ...item, read: read ? 1 : item.read }];
      }) }));
      await onChange();
      after?.();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setWorking(false);
    }
  }
  function open(notice: Notice) {
    const target = () => notice.activity_id ? onOpen(notice.event_id, notice.activity_id) : onOpen(notice.event_id);
    if (notice.read) target();
    else
      void markRead(`notifications/${notice.id}`, () =>
        target(),
      );
  }

  return (
    <section className="notification-center" aria-label="Центр уведомлений">
      <header className="flow-heading">
        <div>
          <h1>Центр уведомлений</h1>
          <p>Записи, переносы, изменения программы и напоминания</p>
        </div>
        <button
          className="button secondary"
          disabled={!unreadCount || working || loading}
          onClick={() => void markRead("notifications")}
        >
          <CheckCheck size={18} />
          Прочитать все
        </button>
      </header>
      <PushSettings send={send} />
      <div className="notification-toolbar">
        <div
          className="notification-filters"
          role="group"
          aria-label="Фильтр уведомлений"
        >
          <button
            aria-pressed={!unreadOnly}
            disabled={working}
            onClick={() => {
              if (unreadOnly) {
                setPage({ items: [], next_cursor: null });
                setUnreadOnly(false);
              }
            }}
          >
            Все
          </button>
          <button
            aria-pressed={unreadOnly}
            disabled={working}
            onClick={() => {
              if (!unreadOnly) {
                setPage({ items: [], next_cursor: null });
                setUnreadOnly(true);
              }
            }}
          >
            Непрочитанные{unreadCount > 0 && <span>{unreadCount}</span>}
          </button>
        </div>
        <p role="status">
          {unreadCount ? `Непрочитанных: ${unreadCount}` : "Всё прочитано"}
          <span>Обновляются автоматически</span>
        </p>
      </div>
      <FormError error={error} />
      {error && (
        <button
          className="text-button notification-retry"
          disabled={working || loading}
          onClick={() => void load()}
        >
          Обновить уведомления
        </button>
      )}
      <div className="notification-list" aria-busy={loading}>
        {page.items.map((notice) => (
          <article
            key={notice.id}
            className={`notification-card ${!notice.read ? "is-unread" : ""} ${notice.kind === "event_cancelled" ? "is-cancellation" : ""}`}
          >
            <span className="notification-icon" aria-hidden="true">
              {notice.kind === "event_cancelled" ? (
                <CircleX size={22} />
              ) : (
                <Bell size={21} />
              )}
            </span>
            <div className="notification-content">
              <div className="notification-meta">
                <time dateTime={new Date(notice.created_at).toISOString()}>
                  {dateLabel(notice.created_at)} ·{" "}
                  {timeLabel(notice.created_at)}
                </time>
                <span className="notification-read-state">
                  {notice.read ? "Прочитано" : "Новое"}
                </span>
              </div>
              <h2>
                {notice.title || (notice.kind === "event_cancelled"
                  ? "Мероприятие отменено организатором"
                  : notice.kind === "club_event"
                    ? "Новое событие клуба"
                  : notice.kind === "event_waitlist"
                    ? "Место на мероприятии освободилось"
                  : notice.kind === "activity_reminder" ? "Скоро начнётся активность"
                  : notice.kind === "event_reminder" ? "Напоминание о мероприятии"
                  : notice.kind === "registration" ? "Ваша запись"
                  : notice.kind === "attendance" ? "Посещение подтверждено"
                  : notice.kind === "webinar" ? "Трансляция"
                  : "Обновление события")}
              </h2>
              <p>{notice.message}</p>
              <div className="notification-actions">
                <button
                  className="button secondary"
                  disabled={working || loading}
                  onClick={() => open(notice)}
                >
                  {notice.event_id ? "Открыть событие" : "Открыть календарь"}
                  <ArrowRight size={16} />
                </button>
                {!notice.read && (
                  <button
                    className="text-button"
                    disabled={working || loading}
                    onClick={() => void markRead(`notifications/${notice.id}`)}
                  >
                    <Check size={17} />
                    Прочитано
                  </button>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>
      {loading && (
        <p className="notification-loading" role="status">
          Загружаем уведомления…
        </p>
      )}
      {!loading && !error && !page.items.length && (
        <div className="notification-empty">
          <Bell size={30} />
          <h2>{unreadOnly ? "Всё прочитано" : "Пока нет уведомлений"}</h2>
          <p>
            {unreadOnly
              ? "Новые сообщения появятся здесь. Вся история доступна во вкладке «Все»."
              : "Сообщим о новых встречах ваших клубов, отменах, переносах и изменениях мероприятий."}
          </p>
        </div>
      )}
      {page.next_cursor && (
        <button
          className="button secondary notification-more"
          disabled={loading || working}
          onClick={() => void load(page.next_cursor!)}
        >
          Показать ещё
        </button>
      )}
    </section>
  );
}
