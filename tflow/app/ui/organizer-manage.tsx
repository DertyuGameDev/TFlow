import { useId, useState, type KeyboardEvent } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Check,
  Clock3,
  MapPin,
  Pencil,
  Plus,
  ScanLine,
  Search,
  Settings2,
  Trash2,
  Users,
  Video,
} from "lucide-react";
import type {
  Activity,
  AttendanceRow,
  EventDetail,
  RequiredProfileField,
  Room,
} from "../../lib/types";
import { dateLabel, timeLabel } from "../../lib/time";
import { hasWebinar } from "../../lib/webinars";
import { REQUIREMENT_FIELDS } from "../../lib/profile-fields";
import { Modal } from "./dialog";
import { ParticipantDetails, RegistrationSettings } from "./profile-data";
import { EventParticipants } from "./event-participants";
import type { Send } from "./forms";
import { ProgramTimeline } from "./program-timeline";
import type { ProgramRange } from "../../lib/program-editing";
import { OrganizerTutorial } from "./organizer-tutorial";
import "../event-management.css";

type Section = "event" | "program" | "participants";
type Props = {
  initialSection?: Section;
  detail: EventDetail;
  rows: AttendanceRow[];
  busy: boolean;
  onScan: () => void;
  onMove: () => void;
  onSchedule: () => void;
  onCreate: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onPublish: () => void;
  onRoom: (room?: Room) => void;
  onActivity: (activity?: Activity, range?: ProgramRange) => void;
  onOpenPublic: () => void;
  onOpenWebinar: () => void;
  send: Send;
  refresh: () => Promise<void>;
};

export function OrganizerManage({
  initialSection = "event",
  detail,
  rows,
  busy,
  onScan,
  onMove,
  onSchedule,
  onCreate,
  onEdit,
  onDelete,
  onPublish,
  onRoom,
  onActivity,
  onOpenPublic,
  onOpenWebinar,
  send,
  refresh,
}: Props) {
  const [section, setSection] = useState<Section>(initialSection);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const id = useId();
  const e = detail.event;
  const tabs = [
    { id: "event" as const, label: "Событие", icon: CalendarDays },
    {
      id: "program" as const,
      label: "Программа",
      icon: Clock3,
      count: detail.activities.length,
    },
    {
      id: "participants" as const,
      label: "Участники",
      icon: Users,
      count: rows.length,
    },
  ];
  const visible = rows.filter(
    (person) =>
      (filter === "all" ||
        (filter === "arrived"
          ? !!person.checked_in_at
          : !person.checked_in_at)) &&
      `${person.name} ${person.email}`
        .toLocaleLowerCase("ru")
        .includes(query.toLocaleLowerCase("ru")),
  );
  const required = REQUIREMENT_FIELDS.filter((field) =>
    e.required_profile_fields?.includes(field.key as RequiredProfileField),
  ).map((field) => field.label);
  function switchWithKeyboard(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft")
      next = (index + tabs.length - 1) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    setSection(tabs[next].id);
    document.getElementById(`${id}-tab-${tabs[next].id}`)?.focus();
  }
  return (
    <section className="event-management" aria-label="Управление событием">
      <header className="management-heading">
        <div>
          <span className={`publication ${e.status}`}>
            {e.status === "published" ? "Опубликовано" : "Черновик"}
          </span>
          <h1>{e.title}</h1>
          <p>
            {dateLabel(e.starts_at)} · {timeLabel(e.starts_at)} МСК ·{" "}
            {e.format === "Онлайн" ? "Онлайн" : e.city}
          </p>
          <OrganizerTutorial
            userId={e.owner_id}
            events={[e]}
            compact
            onAction={(action) => {
              if (action === "create") onCreate();
              else if (action === "schedule") onSchedule();
              else if (action === "program") setSection("program");
              else if (action === "participants") setSection("participants");
              else if (action === "preview") onOpenPublic();
              else if (action === "entry")
                hasWebinar(e) ? onOpenWebinar() : onScan();
              else setSection("event");
            }}
          />
        </div>
        <div className="management-actions">
          {e.status === "draft" ? (
            <button
              className="button primary"
              disabled={busy}
              onClick={onPublish}
            >
              {busy ? "Публикуем…" : "Опубликовать"}
              <ArrowUpRight size={18} />
            </button>
          ) : hasWebinar(e) ? (
            <button className="button primary" onClick={onOpenWebinar}>
              <Video size={18} />
              Открыть студию
            </button>
          ) : (
            <button className="button primary" onClick={onScan}>
              <ScanLine size={18} />
              Сканировать QR
            </button>
          )}
          <button className="button secondary" onClick={onOpenPublic}>
            Страница участника
            <ArrowUpRight size={17} />
          </button>
        </div>
      </header>
      <div
        className="management-tabs"
        role="tablist"
        aria-label="Разделы управления событием"
      >
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`${id}-tab-${tab.id}`}
            aria-selected={section === tab.id}
            aria-controls={`${id}-panel-${tab.id}`}
            tabIndex={section === tab.id ? 0 : -1}
            onClick={() => setSection(tab.id)}
            onKeyDown={(event) => switchWithKeyboard(event, index)}
          >
            <tab.icon size={18} />
            <span>{tab.label}</span>
            {tab.count !== undefined && tab.count > 0 && (
              <small>{tab.count}</small>
            )}
          </button>
        ))}
      </div>
      <section
        role="tabpanel"
        id={`${id}-panel-event`}
        aria-labelledby={`${id}-tab-event`}
        hidden={section !== "event"}
        className="management-panel"
      >
        {e.status === "draft" && (
          <p className="management-draft">
            <Pencil size={18} />
            Событие пока видите только вы. Проверьте сведения и опубликуйте,
            когда будете готовы.
          </p>
        )}
        <dl className="management-metrics">
          <div>
            <dt>Зарегистрировались</dt>
            <dd>
              {e.participant_count}
              <small> / {e.capacity}</small>
            </dd>
          </div>
          <div>
            <dt>Уже вошли</dt>
            <dd>{e.checked_in_count}</dd>
          </div>
          <div>
            <dt>Ожидаем на входе</dt>
            <dd>{Math.max(0, e.participant_count - e.checked_in_count)}</dd>
          </div>
        </dl>
        <EventParticipants
          rows={rows}
          onShowAll={() => {
            setQuery("");
            setFilter("all");
            setSection("participants");
            document.getElementById(`${id}-tab-participants`)?.focus();
          }}
        />
        <article className="management-card">
          <header className="management-section-heading">
            <h2>О событии</h2>
            <button className="button secondary small-button" onClick={onEdit}>
              <Pencil size={16} />
              Редактировать
            </button>
          </header>
          {e.description ? (
            <p className="management-description">{e.description}</p>
          ) : (
            <p className="management-hint">
              Добавьте описание, чтобы участники понимали, что их ждёт.
            </p>
          )}
          <dl className="management-facts">
            <div>
              <dt>
                <CalendarDays size={16} />
                Дата и время
              </dt>
              <dd>
                {dateLabel(e.starts_at)} · {timeLabel(e.starts_at)} —{" "}
                {dateLabel(e.starts_at) !== dateLabel(e.ends_at)
                  ? `${dateLabel(e.ends_at)} · `
                  : ""}
                {timeLabel(e.ends_at)} МСК
              </dd>
            </div>
            <div>
              <dt>
                <MapPin size={16} />
                Место
              </dt>
              <dd>
                {e.format === "Онлайн"
                  ? "Вебинар внутри ТФлоу"
                  : [e.city, e.venue, e.address].filter(Boolean).join(" · ")}
              </dd>
            </div>
            <div>
              <dt>Категория</dt>
              <dd>{e.topic}</dd>
            </div>
            <div>
              <dt>Формат</dt>
              <dd>
                {e.format} · {e.kind}
              </dd>
            </div>
          </dl>
          <div className="management-other-actions">
            <button className="button secondary" onClick={onMove}>
              <CalendarDays size={17} />
              Перенести событие
            </button>
            <button className="button danger-outline" onClick={onDelete}>
              <Trash2 size={17} />
              Удалить событие
            </button>
          </div>
        </article>
      </section>
      <section
        role="tabpanel"
        id={`${id}-panel-program`}
        aria-labelledby={`${id}-tab-program`}
        hidden={section !== "program"}
        className="management-panel"
      >
        <section className="management-card management-schedule">
          <header className="management-section-heading">
            <div>
              <h2>Расписание мероприятия</h2>
              <p>Общее время и место встречи. Всё время указано по МСК.</p>
            </div>
            <button className="button secondary" onClick={onSchedule}>
              <Settings2 size={17} />
              Изменить время и место
            </button>
          </header>
          <dl className="management-facts management-schedule-facts">
            <div>
              <dt>
                <CalendarDays size={15} />
                Начало
              </dt>
              <dd>
                <time dateTime={new Date(e.starts_at).toISOString()}>
                  {dateLabel(e.starts_at, { year: "numeric" })}
                  <strong>{timeLabel(e.starts_at)}</strong>
                </time>
              </dd>
            </div>
            <div>
              <dt>
                <Clock3 size={15} />
                Окончание
              </dt>
              <dd>
                <time dateTime={new Date(e.ends_at).toISOString()}>
                  {dateLabel(e.ends_at, { year: "numeric" })}
                  <strong>{timeLabel(e.ends_at)}</strong>
                </time>
              </dd>
            </div>
            <div>
              <dt>
                <MapPin size={15} />
                Место
              </dt>
              <dd>
                {e.format === "Онлайн"
                  ? "Вебинар внутри ТФлоу"
                  : [e.city, e.venue, e.address].filter(Boolean).join(" · ")}
              </dd>
            </div>
          </dl>
        </section>
        <header className="management-section-heading">
          <div>
            <h2>Пункты программы</h2>
            <p>
              Составьте расписание: укажите, что будет происходить и во сколько.
            </p>
          </div>
          <button className="button primary" onClick={() => onActivity()}>
            <Plus size={18} />
            Добавить пункт программы
          </button>
        </header>
        <ProgramTimeline
          event={e}
          activities={detail.activities}
          rooms={detail.rooms}
          onEdit={onActivity}
          onCreate={(range) => onActivity(undefined, range)}
          onReschedule={async (activity, range) => {
            const current = detail.activities.find(
              (item) => item.id === activity.id,
            );
            if (!current || current.updated_at !== activity.updated_at)
              throw new Error(
                "Этот пункт уже изменился. Проверьте его время и повторите действие.",
              );
            await send(`activities/${current.id}`, "PATCH", {
              title: current.title,
              description: current.description,
              speaker: current.speaker,
              room_id: current.room_id,
              capacity: current.capacity,
              starts_at: range.starts_at,
              ends_at: range.ends_at,
            });
            await refresh();
          }}
        />
        <section className="management-card management-rooms">
          <header className="management-section-heading">
            <div>
              <h3>Аудитории</h3>
              <p>
                Очные залы и несколько онлайн-потоков могут работать параллельно.
                Для каждого одновременного эфира создайте свою онлайн-аудиторию.
              </p>
            </div>
            <button className="text-button" onClick={() => onRoom()}>
              <Plus size={17} />
              Добавить аудиторию
            </button>
          </header>
          <div className="management-room-list">
            {detail.rooms.map((room) => (
              <button
                key={room.id}
                onClick={() => onRoom(room)}
                aria-label={`Изменить аудиторию ${room.name}`}
              >
                <span>
                  <strong>{room.name}</strong>
                  <small>
                    {room.is_online
                      ? `Вебинар · ${room.capacity} зрителей`
                      : `${room.capacity} мест`}
                  </small>
                </span>
                {room.is_online ? <Video size={16} /> : <Pencil size={16} />}
              </button>
            ))}
          </div>
          {detail.rooms.some((room) => room.is_online) &&
            hasWebinar(e) &&
            e.status === "published" && (
              <button className="text-button" onClick={onOpenWebinar}>
                <Video size={17} /> Выбрать онлайн-флоу
              </button>
            )}
        </section>
      </section>
      <section
        role="tabpanel"
        id={`${id}-panel-participants`}
        aria-labelledby={`${id}-tab-participants`}
        hidden={section !== "participants"}
        className="management-panel"
      >
        <section className="management-registration management-card">
          <div>
            <h3>Что спросить при записи</h3>
            <p>
              Имя и почта
              {required.length
                ? ` + ${required.length} доп. ${required.length === 1 ? "поле" : required.length < 5 ? "поля" : "полей"}`
                : " — без дополнительных требований"}
            </p>
            <small>
              Телефон и другие сведения можно запросить, если они нужны для
              встречи.
            </small>
          </div>
          <button
            className="button secondary"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings2 size={17} />
            Настроить
          </button>
        </section>
        <header className="management-section-heading">
          <h2>
            Участники <span className="management-count">{rows.length}</span>
          </h2>
          {e.status === "published" && e.format !== "Онлайн" && (
            <button className="button secondary" onClick={onScan}>
              <ScanLine size={18} />
              Проверить QR
            </button>
          )}
        </header>
        {rows.length > 0 && (
          <div className="attendee-tools">
            <label className="small-search">
              <Search size={17} />
              <input
                aria-label="Найти участника"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Имя или почта"
              />
            </label>
            <div
              className="segmented"
              role="group"
              aria-label="Фильтр участников"
            >
              {[
                ["all", "Все"],
                ["arrived", "Вошли"],
                ["waiting", "Ожидаем"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  aria-pressed={filter === value}
                  className={filter === value ? "selected" : ""}
                  onClick={() => setFilter(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}
        {visible.length ? (
          <div className="attendee-list">
            {visible.map((person) => (
              <details className="attendee-record" key={person.id}>
                <summary className="attendee-row">
                  <span className="small-person-avatar">
                    {person.name.slice(0, 1)}
                  </span>
                  <div>
                    <h3>{person.name}</h3>
                    <p>{person.email}</p>
                  </div>
                  <span
                    className={`arrival-badge ${person.checked_in_at ? "arrived" : ""}`}
                  >
                    {person.checked_in_at ? (
                      <>
                        <Check size={14} />
                        Вошёл в {timeLabel(person.checked_in_at)}
                      </>
                    ) : (
                      "Ожидаем"
                    )}
                  </span>
                  <span className="attendee-expand">
                    Данные
                    <ArrowRight size={15} />
                  </span>
                </summary>
                <div className="attendee-profile">
                  <p className="snapshot-caption">
                    Данные при записи · {dateLabel(person.created_at)}
                  </p>
                  <ParticipantDetails data={person.profile_data} />
                </div>
              </details>
            ))}
          </div>
        ) : (
          <div className="management-empty">
            <Users size={30} />
            <h3>
              {rows.length ? "Никого не нашли" : "Ждём первых участников"}
            </h3>
            <p>
              {rows.length
                ? "Попробуйте другое имя или фильтр."
                : e.status === "draft"
                  ? "После публикации на событие смогут записаться. Участники появятся здесь."
                  : "Поделитесь страницей события — записавшиеся участники появятся здесь."}
            </p>
            {rows.length === 0 && (
              <button className="button secondary" onClick={onOpenPublic}>
                Открыть страницу события
                <ArrowUpRight size={17} />
              </button>
            )}
          </div>
        )}
      </section>
      {settingsOpen && (
        <Modal
          title="Данные при записи"
          subtitle="Выберите, какие сведения нужны организатору."
          onClose={() => setSettingsOpen(false)}
        >
          <RegistrationSettings
            event={e}
            send={send}
            refresh={refresh}
            inDialog
          />
        </Modal>
      )}
    </section>
  );
}
