import { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Camera,
  Bell,
  BellOff,
  Check,
  Heart,
  Pencil,
  Plus,
  Search,
  Users,
} from "lucide-react";
import type {
  Bootstrap,
  Community,
  FlowEvent,
  UserIdentity,
} from "../../lib/types";
import { parseInterests } from "../../lib/interests";
import { dateLabel, timeLabel } from "../../lib/time";
import { CategorySelect } from "./category-select";
import { FormError, Submit, useSubmit, type Send } from "./forms";
import { Modal } from "./dialog";
import { Avatar, AvatarForm } from "./avatar";
import "../clubs.css";

function ClubForm({
  club,
  send,
  done,
}: {
  club?: Community;
  send: Send;
  done: (id: string) => Promise<void>;
}) {
  const { submit, error, busy } = useSubmit(async (data) => {
    const result = (await send(
      club ? `communities/${club.id}` : "communities",
      club ? "PATCH" : "POST",
      Object.fromEntries(data),
    )) as { id: string };
    await done(result.id);
  });
  return (
    <form className="flow-form" onSubmit={submit}>
      <label>
        Название клуба
        <input
          name="name"
          required
          defaultValue={club?.name}
          placeholder="Например, любители настольных игр"
        />
      </label>
      <CategorySelect defaultValue={club?.topic} />
      <label>
        О клубе
        <textarea
          name="description"
          required
          rows={4}
          defaultValue={club?.description}
          placeholder="Кого объединяет клуб и какие встречи вы планируете?"
        />
      </label>
      <FormError error={error} />
      <Submit busy={busy} label={club ? "Сохранить клуб" : "Создать клуб"} />
    </form>
  );
}

export function Clubs({
  data,
  user,
  clubId,
  send,
  onChange,
  onOpenClub,
  onOpenEvent,
  onCreateEvent,
}: {
  data: Bootstrap;
  user: UserIdentity | null;
  clubId?: string;
  send: Send;
  onChange: () => Promise<void>;
  onOpenClub: (id?: string) => void;
  onOpenEvent: (event: FlowEvent) => void;
  onCreateEvent: (club: Community) => void;
}) {
  const [query, setQuery] = useState(""),
    [topic, setTopic] = useState(""),
    [mode, setMode] = useState("all");
  const [editing, setEditing] = useState<Community | "new" | null>(null);
  const [avatarEditing, setAvatarEditing] = useState<Community | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [showPast, setShowPast] = useState(false);
  const interests = parseInterests(data.profile?.interests ?? "");
  const club = data.communities.find((item) => item.id === clubId);
  const visible = data.communities.filter(
    (item) =>
      (!query ||
        `${item.name} ${item.description} ${item.topic}`
          .toLocaleLowerCase("ru")
          .includes(query.toLocaleLowerCase("ru"))) &&
      (!topic || item.topic === topic) &&
      (mode !== "mine" || item.joined) &&
      (mode !== "interests" || interests.includes(item.topic)),
  );
  const now = Date.now();
  const clubEvents = club
    ? data.events.filter((event) => event.community_id === club.id)
    : [];
  const upcomingEvents = clubEvents
    .filter((event) => event.ends_at > now)
    .sort((a, b) => a.starts_at - b.starts_at);
  const pastEvents = clubEvents
    .filter((event) => event.ends_at <= now)
    .sort((a, b) => b.ends_at - a.ends_at);
  const events = showPast ? pastEvents : upcomingEvents;
  async function join(item: Community) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await send(
        `communities/${item.id}/join`,
        item.joined ? "DELETE" : "POST",
        item.joined ? undefined : {},
      );
      await onChange();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function membership(item: Community) {
    return user ? (
      <button
        className={`button ${item.joined ? "secondary" : "primary"}`}
        disabled={busy}
        onClick={() => void join(item)}
      >
        {item.joined ? (
          <>
            <Check size={17} />
            Вы в клубе · Выйти
          </>
        ) : (
          <>
            <Plus size={17} />
            Вступить в клуб
          </>
        )}
      </button>
    ) : (
      <a
        className="button primary"
        href={`/login/?next=${encodeURIComponent("/#clubs/" + item.id)}`}
      >
        Войти и вступить
        <ArrowRight size={17} />
      </a>
    );
  }
  async function subscription(item: Community) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await send(`communities/${item.id}/subscription`, "PATCH", {enabled: !item.subscribed});
      await onChange();
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }
  return (
    <section className="clubs-page">
      {clubId ? (
        <>
          <button className="back-link" onClick={() => onOpenClub()}>
            <ArrowLeft size={17} />
            Все клубы
          </button>
          {!club ? (
            <div className="clubs-empty">
              <h1>Клуб не найден</h1>
              <p>Вернитесь к списку и выберите другой клуб.</p>
            </div>
          ) : (
            <>
              <div className="clubs-hero">
                <div className="club-photo-heading">
                  {club.owner_id === user?.userId ? (
                    <>
                      <button
                        className="club-avatar-edit"
                        aria-label="Изменить фото клуба"
                        onClick={() => setAvatarEditing(club)}
                      >
                        <Avatar
                          profile={club}
                          className="club-avatar club-avatar-large"
                        />
                        <span className="club-avatar-camera">
                          <Camera size={17} />
                        </span>
                      </button>
                      <button
                        className="text-button"
                        onClick={() => setAvatarEditing(club)}
                      >
                        {club.avatar_url
                          ? "Изменить фото"
                          : "Добавить фото клуба"}
                      </button>
                    </>
                  ) : (
                    <Avatar
                      profile={club}
                      className="club-avatar club-avatar-large"
                    />
                  )}
                </div>
                <span className="clubs-topic">{club.topic}</span>
                <h1>{club.name}</h1>
                <p>{club.description}</p>
                <span className="clubs-counts">
                  Участников: {club.member_count} · Опубликованных событий:{" "}
                  {club.event_count}
                </span>
                <div className="clubs-hero-actions">
                  {membership(club)}
                  {!!club.joined && <button type="button" className="button secondary" disabled={busy}
                    aria-pressed={club.subscribed} onClick={()=>void subscription(club)}>
                    {club.subscribed ? <Bell size={17} /> : <BellOff size={17} />}
                    {club.subscribed ? "Вы подписаны на события" : "Подписаться на события"}
                  </button>}
                  {club.owner_id === user?.userId && (
                    <button
                      className="button secondary"
                      onClick={() => setEditing(club)}
                    >
                      <Pencil size={17} />
                      Изменить клуб
                    </button>
                  )}
                  {user?.role === "organizer" &&
                    (club.joined || club.owner_id === user.userId) && (
                      <button
                        className="button secondary"
                        onClick={() => onCreateEvent(club)}
                      >
                        <CalendarDays size={17} />
                        Создать событие клуба
                      </button>
                    )}
                </div>
                {!!club.joined && <p className="club-subscription-hint">
                  {club.subscribed ? "Новые встречи клуба появятся в ваших уведомлениях." : "Подпишитесь, чтобы узнавать о новых встречах клуба."}
                </p>}
              </div>
              <div className="clubs-events-heading">
                <h2>События клуба</h2>
                <div
                  className="clubs-event-periods"
                  role="group"
                  aria-label="Период событий клуба"
                >
                  <button
                    type="button"
                    aria-pressed={!showPast}
                    onClick={() => setShowPast(false)}
                  >
                    Предстоящие <span>{upcomingEvents.length}</span>
                  </button>
                  <button
                    type="button"
                    aria-pressed={showPast}
                    onClick={() => setShowPast(true)}
                  >
                    Прошедшие <span>{pastEvents.length}</span>
                  </button>
                </div>
              </div>
              {events.length ? (
                <div className="clubs-event-list">
                  {events.map((event) => (
                    <button
                      className="clubs-event"
                      key={event.id}
                      onClick={() => onOpenEvent(event)}
                    >
                      <CalendarDays size={23} />
                      <span>
                        <strong>{event.title}</strong>
                        <small>
                          {dateLabel(event.starts_at)} ·{" "}
                          {timeLabel(event.starts_at)} · {event.city}
                          {event.status === "draft" ? " · Ваш черновик" : ""}
                        </small>
                      </span>
                      <ArrowRight size={18} />
                    </button>
                  ))}
                </div>
              ) : (
                <div className="clubs-empty">
                  <CalendarDays size={28} />
                  <h2>
                    {showPast
                      ? "Прошедших событий пока нет"
                      : "Новые встречи ещё впереди"}
                  </h2>
                  <p>
                    {showPast
                      ? "Завершённые встречи клуба появятся здесь."
                      : pastEvents.length
                        ? "Посмотрите предыдущие встречи в разделе «Прошедшие». Новые события появятся здесь."
                        : "Здесь появятся события, которые организаторы добавят в этот клуб."}
                  </p>
                </div>
              )}
            </>
          )}
        </>
      ) : (
        <>
          <header className="flow-heading">
            <div>
              <h1>Клубы по интересам</h1>
              <p>Находите своих людей и встречи, на которые хочется прийти</p>
            </div>
            {user ? (
              <button
                className="button primary"
                onClick={() => setEditing("new")}
              >
                <Plus size={18} />
                Создать клуб
              </button>
            ) : (
              <a className="button secondary" href="/login/?next=%2F%23clubs">
                Войти
              </a>
            )}
          </header>
          <div className="clubs-filters">
            <label className="clubs-search">
              <Search size={19} />
              <input
                type="search"
                aria-label="Найти клуб"
                placeholder="Название или интерес"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <CategorySelect allowAll value={topic} onChange={setTopic} />
          </div>
          <div className="clubs-tabs" role="group" aria-label="Подборка клубов">
            {[
              ["all", "Все клубы"],
              ["mine", "Мои клубы"],
              ["interests", "По моим интересам"],
            ].map(([id, label]) => (
              <button
                key={id}
                aria-pressed={mode === id}
                onClick={() => setMode(id)}
              >
                {id === "interests" && <Heart size={15} />}
                <span>{label}</span>
              </button>
            ))}
          </div>
          {mode === "interests" && !interests.length && (
            <p className="clubs-tip">
              Добавьте интересы в <a href="#profile">профиле</a>, чтобы
              подобрать подходящие клубы.
            </p>
          )}
          {mode === "mine" && !user && (
            <p className="clubs-tip">
              Войдите, чтобы видеть клубы, в которые вы вступили.
            </p>
          )}
          {visible.length ? (
            <div className="clubs-grid">
              {visible.map((item) => (
                <article className="clubs-card" key={item.id}>
                  <button
                    className="club-avatar-link"
                    aria-label={`Открыть клуб ${item.name}`}
                    onClick={() => onOpenClub(item.id)}
                  >
                    <Avatar profile={item} className="club-avatar" />
                  </button>
                  <div className="clubs-card-copy">
                    <h2>
                      <button onClick={() => onOpenClub(item.id)}>
                        <span>{item.name}</span>
                        <ArrowRight size={16} />
                      </button>
                    </h2>
                    <span className="clubs-topic">{item.topic}</span>
                    <p className="clubs-card-description">{item.description}</p>
                    <span className="clubs-counts">
                      Участников: {item.member_count} · Событий:{" "}
                      {item.event_count}
                    </span>
                    {Boolean(item.joined) && (
                      <span className="clubs-member">
                        <Check size={14} />
                        Вы в клубе
                      </span>
                    )}
                    {interests.includes(item.topic) && (
                      <span className="clubs-match">
                        <Heart size={14} />
                        Совпадает с вашими интересами
                      </span>
                    )}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="clubs-empty">
              <Users size={30} />
              <h2>
                {query || topic
                  ? "Клубы не найдены"
                  : mode === "mine"
                    ? "Вы пока не вступили в клубы"
                    : mode === "interests"
                      ? "Подходящих клубов пока нет"
                      : "Начните с вашего интереса"}
              </h2>
              <p>
                {query || topic
                  ? "Попробуйте другой запрос или категорию."
                  : "Создайте клуб или выберите подходящий в разделе «Все клубы»."}
              </p>
              {(query || topic) && (
                <button
                  className="button secondary"
                  onClick={() => {
                    setQuery("");
                    setTopic("");
                  }}
                >
                  Сбросить поиск
                </button>
              )}
            </div>
          )}
        </>
      )}
      <FormError error={error} />
      {avatarEditing && (
        <Modal title="Фото клуба" onClose={() => setAvatarEditing(null)}>
          <AvatarForm
            profile={avatarEditing}
            endpoint={`communities/${avatarEditing.id}/avatar`}
            description="Фото появится в списке и на странице клуба. Изображение обрежется по центру в круг."
            send={send}
            done={async () => {
              await onChange();
              setAvatarEditing(null);
            }}
          />
        </Modal>
      )}
      {editing && (
        <Modal
          title={editing === "new" ? "Создать клуб" : "Изменить клуб"}
          onClose={() => setEditing(null)}
        >
          <ClubForm
            club={editing === "new" ? undefined : editing}
            send={send}
            done={async (id) => {
              setEditing(null);
              await onChange();
              onOpenClub(id);
            }}
          />
        </Modal>
      )}
    </section>
  );
}
