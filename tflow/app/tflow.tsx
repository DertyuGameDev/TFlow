import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  CalendarDays,
  Check,
  Clock3,
  Download,
  Camera,
  Copy,
  Heart,
  LayoutDashboard,
  MapPin,
  Pencil,
  Plus,
  QrCode,
  ScanLine,
  Search,
  SlidersHorizontal,
  Trash2,
  Users,
  Video,
  X,
} from "lucide-react";
import type {
  Activity,
  AttendanceRow,
  Bootstrap,
  EventDetail,
  FlowEvent,
  Profile,
  RequiredProfileField,
  Room,
  UserIdentity,
  Community,
} from "../lib/types";
import { CategorySelect } from "./ui/category-select";
import { parseInterests } from "../lib/interests";
import { csrfToken, signInPath } from "../lib/session";
import { dateLabel, timeLabel } from "../lib/time";
import { canEnterWebinar, hasWebinar } from "../lib/webinars";
import { Modal } from "./ui/dialog";
import { FormError, RoomForm } from "./ui/forms";
import { ActivityForm } from "./ui/program-item-form";
import { QuickEventForm } from "./ui/quick-event-form";
import { QRScanner } from "./ui/qr-scanner";
import { EventArt } from "./ui/event-card";
import {
  ActivityCard,
  ActivityProgram,
  type ActivityAction,
} from "./ui/activity-program";
import { Avatar, AvatarForm } from "./ui/avatar";
import { CityPicker } from "./ui/city-picker";
import { BrandLogo } from "./ui/brand-logo";
import { OrganizerIntro } from "./ui/organizer-intro";
import { Calendar } from "./ui/calendar";
import { EventRemovalDialog } from "./ui/event-removal-dialog";
import { NotificationCenter } from "./ui/notification-center";
import { CheckInStatus } from "./ui/check-in-status";
import { EventRegistrationAction, EventWaitlists } from "./ui/event-waitlist";
import { Clubs } from "./ui/clubs";
import { OrganizerManage } from "./ui/organizer-manage";
import { AccountMenu } from "./ui/account-menu";
import { EventTimeFilterControl } from "./ui/event-time-filter";
import { splitOrganizerEvents } from "../lib/organizer-events";
import type { ProgramRange } from "../lib/program-editing";
import { matchesEventTime, type EventTimeFilter } from "../lib/event-filters";
import { OrganizerTutorial } from "./ui/organizer-tutorial";
import { ProfileUpcomingEvents } from "./ui/profile-upcoming-events";
import { EventFlows } from "./ui/event-flows";
import { CatalogActivities } from "./ui/catalog-activities";
import { WebinarChannels } from "./ui/webinar-channels";
import { ThemeToggle } from "./ui/theme-toggle";
const Webinar = lazy(() => import("./ui/webinar"));
import {
  CompleteRegistrationForm,
  ExpandedProfileForm,
  ParticipantDetails,
} from "./ui/profile-data";
import { ApiError } from "../lib/api-error";
import { REQUIREMENT_FIELDS } from "../lib/profile-fields";

type Route = { view: string; id?: string; mode?: string };
function attendanceScope(view: string, organizer: boolean) {
  if (!organizer) return "none";
  return ["manage", "scan"].includes(view) ? "required" : "none";
}
type DialogState =
  | { type: "create"; startsAt?: number; communityId?: string }
  | {
      type: "edit" | "move" | "schedule" | "cancel" | "delete";
      event: FlowEvent;
    }
  | { type: "profile" | "avatar" }
  | {
      type: "enroll";
      event: FlowEvent;
      path: string;
      missing: RequiredProfileField[];
      message: string;
    }
  | { type: "filters" }
  | { type: "room"; room?: Room }
  | { type: "activity"; activity?: Activity; range?: ProgramRange }
  | null;
const empty: Bootstrap = {
  events: [],
  tickets: [],
  schedule: [],
  waitlist: [],
  communities: [],
  notifications: [],
  unread_notification_count: 0,
  profile: null,
};
const go = (view: string, id?: string, mode?: string) => {
  location.hash = [view, id, mode].filter(Boolean).join("/");
  window.scrollTo({ top: 0, behavior: "instant" });
};
const routeFromHash = (organizer: boolean): Route => {
  const [view, id, mode] = location.hash.slice(1).split("/");
  if (view === "tickets") return { view: "calendar" };
  if (view === "webinar" && !id) return { view: "events" };
  const valid = [
    "events",
    "calendar",
    "profile",
    "saved",
    "schedule",
    "organizer",
    "manage",
    "scan",
    "event",
    "webinar",
    "pass",
    "notifications",
    "communities",
    "clubs",
    "places",
  ];
  return valid.includes(view)
    ? { view, id, mode }
    : { view: organizer ? "organizer" : "events" };
};
const loginLink = (view = "events", id?: string) =>
  `/login/?next=${encodeURIComponent("/#" + view + (id ? "/" + id : ""))}`;
const signupLink = (view = "events", id?: string) =>
  `/register/?next=${encodeURIComponent("/#" + view + (id ? "/" + id : ""))}`;

const plural = (n: number, forms: [string, string, string]) =>
  `${n} ${forms[n % 100 >= 11 && n % 100 <= 14 ? 2 : n % 10 === 1 ? 0 : n % 10 >= 2 && n % 10 <= 4 ? 1 : 2]}`;
function Empty({
  title,
  text,
  children,
  icon: Icon = CalendarDays,
}: {
  title: string;
  text: string;
  children?: React.ReactNode;
  icon?: typeof CalendarDays;
}) {
  return (
    <div className="quiet-empty">
      <span className="empty-symbol">
        <Icon size={28} strokeWidth={1.6} aria-hidden="true" />
      </span>
      <h2>{title}</h2>
      <p>{text}</p>
      {children}
    </div>
  );
}
function Heading({
  title,
  text,
  children,
}: {
  title: string;
  text?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flow-heading">
      <div>
        <h1>{title}</h1>
        {text && <p>{text}</p>}
      </div>
      {children}
    </div>
  );
}
function CatalogFilters({
  cities,
  initial,
  onApply,
}: {
  cities: string[];
  initial: { city: string; date: string; format: string };
  onApply: (values: { city: string; date: string; format: string }) => void;
}) {
  const [values, setValues] = useState(initial);
  return (
    <form
      className="flow-form"
      onSubmit={(e) => {
        e.preventDefault();
        onApply(values);
      }}
    >
      <CityPicker
        value={values.city}
        onChange={(city) => setValues({ ...values, city })}
        cities={cities}
        required={false}
      />
      <div className="form-field">
        <label htmlFor="filter-date">Дата</label>
        <input
          id="filter-date"
          type="date"
          value={values.date}
          onChange={(e) => setValues({ ...values, date: e.target.value })}
        />
      </div>
      <div className="form-field">
        <label htmlFor="filter-format">Формат</label>
        <select
          id="filter-format"
          value={values.format}
          onChange={(e) => setValues({ ...values, format: e.target.value })}
        >
          <option value="">Любой формат</option>
          <option>Очно</option>
          <option>Онлайн</option>
          <option>Гибрид</option>
        </select>
      </div>
      <div className="filter-form-actions">
        <button
          className="text-button"
          type="button"
          onClick={() => setValues({ city: "", date: "", format: "" })}
        >
          Сбросить
        </button>
        <button className="button primary" type="submit">
          Показать события
          <ArrowRight size={18} />
        </button>
      </div>
    </form>
  );
}
function EventMeta({ event }: { event: FlowEvent }) {
  return (
    <div className="event-facts">
      <span>
        <CalendarDays size={17} />
        {dateLabel(event.starts_at)} · {timeLabel(event.starts_at)}
      </span>
      <span>
        <MapPin size={17} />
        {event.city} · {event.venue}
      </span>
    </div>
  );
}
function DiscoveryCard({
  event,
  activities,
  onSave,
  userId,
}: {
  event: FlowEvent;
  activities?: Activity[];
  onSave: () => void;
  userId?: string;
}) {
  const ended = matchesEventTime(event, "past");
  return (
    <article className={`discovery-card${ended ? " is-past" : ""}`}>
      <div className="discovery-cover">
        <button
          className="cover-open"
          aria-label={`Открыть ${event.title}`}
          onClick={() => go("event", event.id)}
        >
          <EventArt
            cover={event.cover}
            title={event.topic === "Искусственный интеллект" ? "AI" : undefined}
          />
        </button>
        <span className="event-kind">{event.kind}</span>
        <button
          className={`favorite ${event.saved ? "favorite-on" : ""}`}
          aria-label={
            event.saved
              ? `Убрать из избранного ${event.title}`
              : `Сохранить ${event.title}`
          }
          aria-pressed={!!event.saved}
          onClick={onSave}
        >
          <Heart size={20} fill={event.saved ? "currentColor" : "none"} />
        </button>
        {event.enrolled > 0 && (
          <span className="registered-tag">
            <Check size={12} />
            {ended
              ? event.checked_in ? "Вы посетили" : "Вы были записаны"
              : event.checked_in ? "Вы вошли" : "Вы идёте"}
          </span>
        )}
        {!event.enrolled && !!event.event_waitlisted && <span className="registered-tag event-waitlist-tag">
          <Clock3 size={12} />{ended ? "Были в очереди" : "В очереди"} · №{event.event_waitlist_position}
        </span>}
      </div>
      <div className="discovery-copy">
        <p>
          {dateLabel(event.starts_at)} · {timeLabel(event.starts_at)}
        </p>
        <h2>
          <button onClick={() => go("event", event.id)}>{event.title}</button>
        </h2>
        <span>
          {event.format === "Онлайн"
            ? "Онлайн"
            : `${event.city} · ${event.venue}`}
        </span>
        {ended ? (
          <span className="event-ended-label"><Clock3 size={14} aria-hidden="true" />Завершено</span>
        ) : <strong>Бесплатно</strong>}
        {activities && <CatalogActivities activities={activities} />}
        {canEnterWebinar(event, userId) && (
          <button
            className="button secondary webinar-card-entry"
            onClick={() => go("webinar", event.id)}
          >
            <Video size={18} />
            {event.owner_id === userId ? "Открыть студию" : "Войти в вебинар"}
          </button>
        )}
      </div>
    </article>
  );
}

function ProfileView({
  profile,
  organizer,
  events,
  onCreate,
  onEdit,
  onAvatar,
  pending,
  onLeaveEventWaitlist,
}: {
  profile: Profile;
  organizer: boolean;
  events: FlowEvent[];
  onCreate: () => void;
  onEdit: () => void;
  onAvatar: () => void;
  pending: boolean;
  onLeaveEventWaitlist: (event: FlowEvent) => void;
}) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">(
    "idle",
  );
  const checkedInEvents = events.filter(
    (event) => event.enrolled && event.checked_in && event.ends_at > Date.now(),
  );
  return (
    <>
      <Heading
        title="Ваш профиль"
        text={
          organizer
            ? "Аккаунт организатора · роль изменить нельзя"
            : "Аккаунт участника · роль изменить нельзя"
        }
      />
      <div
        className={`personal-layout${organizer ? " organizer-profile-layout" : ""}`}
      >
        {!organizer && (
          <section className="personal-pass">
            <div className="pass-top">
              <BrandLogo />
              <span>Личный пропуск</span>
            </div>
            {checkedInEvents.length > 0 && (
              <div className="participant-entry-list">
                {checkedInEvents.map((event) => (
                  <CheckInStatus key={event.id} event={event} />
                ))}
              </div>
            )}
            <img
              src="/api/profile/qr"
              alt="Ваш личный QR-код для входа на мероприятия"
              width={260}
              height={260}
            />
            <h2>{profile.name || "Личный QR"}</h2>
            <p>Покажите этот QR на входе</p>
            <button
              className="button secondary copy-pass"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(
                    `${location.origin}/#pass/${profile.pass_token}`,
                  );
                  setCopyState("copied");
                } catch {
                  setCopyState("error");
                }
              }}
            >
              {copyState === "copied" ? (
                <Check size={17} />
              ) : (
                <Copy size={17} />
              )}{" "}
              {copyState === "copied"
                ? "Ссылка скопирована"
                : "Скопировать ссылку"}
            </button>
            <p className="copy-feedback" role="status">
              {copyState === "error"
                ? "Не удалось скопировать. Покажите QR с экрана."
                : copyState === "copied"
                  ? "Ссылку можно отправить организатору."
                  : "Один код подходит для всех ваших событий"}
            </p>
            <div className="pass-caption">
              <Check size={16} />
              На входе проверим вашу регистрацию
            </div>
          </section>
        )}
        <div className="profile-sections">
          {!organizer && <EventWaitlists events={events} pending={pending} onLeave={onLeaveEventWaitlist} />}
          <section className="personal-info">
            <div className="person-heading">
              <button
                className="avatar-edit"
                aria-label="Изменить фото профиля"
                onClick={onAvatar}
              >
                <Avatar profile={profile} />
                <span className="avatar-camera">
                  <Camera size={13} />
                </span>
              </button>
              <div>
                <h2>{profile.name || "Заполните профиль"}</h2>
                <span>{organizer ? "Организатор" : "Участник"}</span>
              </div>
              <button
                className="icon-button"
                aria-label="Редактировать профиль"
                onClick={onEdit}
              >
                <Pencil size={18} />
              </button>
            </div>
            <p className="profile-sharing-note">
              {organizer
                ? "Создавайте события и управляйте ими в кабинете организатора."
                : "Заполните профиль один раз. При записи организатор получит ваши данные, а недостающее можно будет добавить по пути."}
            </p>
            <ParticipantDetails data={profile} showEmpty />

            <button className="button secondary" onClick={onEdit}>
              <Pencil size={16} />
              Изменить профиль
            </button>
            <button
              className="text-button profile-avatar-link"
              onClick={onAvatar}
            >
              <Camera size={16} />
              Изменить фото
            </button>
            <form className="logout-form" method="post" action="/logout/">
              <input
                type="hidden"
                name="csrfmiddlewaretoken"
                value={csrfToken()}
              />
              <button className="text-button">Выйти из аккаунта</button>
            </form>
          </section>
        </div>
        {organizer && (
          <ProfileUpcomingEvents
            events={events}
            organizerId={profile.id}
            onCreate={onCreate}
          />
        )}
      </div>
    </>
  );
}

function OrganizerEvent({
  event,
  onMove,
  onDelete,
}: {
  event: FlowEvent;
  onMove: () => void;
  onDelete: () => void;
}) {
  const published = event.status === "published";
  return (
    <article className="host-event">
      <button
        className="host-event-art"
        onClick={() => go("manage", event.id)}
        aria-label={`Управлять ${event.title}`}
      >
        <EventArt cover={event.cover} />
      </button>
      <div className="host-event-info">
        <span className={`publication ${event.status}`}>
          {published ? "Опубликовано" : "Черновик"}
        </span>
        <h2>
          <button onClick={() => go("manage", event.id)}>{event.title}</button>
        </h2>
        <EventMeta event={event} />
        <div className="host-event-numbers">
          <span>
            <Users size={16} />
            {plural(event.participant_count, [
              "участник",
              "участника",
              "участников",
            ])}
          </span>
          <span>
            <Check size={16} />
            {event.checked_in_count} на входе
          </span>
        </div>
      </div>
      <div className="host-event-actions">
        <button
          className="button primary"
          onClick={() =>
            go(
              published ? (hasWebinar(event) ? "webinar" : "scan") : "manage",
              event.id,
            )
          }
        >
          {published ? (
            hasWebinar(event) ? (
              <Video size={18} />
            ) : (
              <ScanLine size={18} />
            )
          ) : (
            <Pencil size={18} />
          )}
          <span>
            {published
              ? hasWebinar(event)
                ? "Открыть студию"
                : "Сканировать QR"
              : "Подготовить событие"}
          </span>
        </button>
        <button className="button secondary" onClick={onMove}>
          <CalendarDays size={17} />
          Перенести
        </button>
        <button className="button danger-outline" onClick={onDelete}>
          <Trash2 size={17} />
          Удалить мероприятие
        </button>
        <button
          className="text-button"
          onClick={() => go(published ? "manage" : "event", event.id)}
        >
          {published ? "Участники и настройки" : "Предпросмотр"}
          <ArrowRight size={16} />
        </button>
      </div>
    </article>
  );
}

export function TFlow({ user }: { user: UserIdentity | null }) {
  const organizer = user?.role === "organizer";
  const [route, setRoute] = useState<Route>(() => routeFromHash(organizer)),
    [data, setData] = useState<Bootstrap>(empty),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const organizerArea = organizer;
  const [detail, setDetail] = useState<EventDetail | null>(null),
    [detailError, setDetailError] = useState(""),
    [rows, setRows] = useState<AttendanceRow[]>([]);
  const [dialog, setDialog] = useState<DialogState>(null),
    [toast, setToast] = useState<{ text: string; error: boolean } | null>(null),
    [pending, setPending] = useState(false);
  const [query, setQuery] = useState(""),
    [city, setCity] = useState(""),
    [topic, setTopic] = useState(""),
    [clubFilter, setClubFilter] = useState(""),
    [format, setFormat] = useState(""),
    [date, setDate] = useState("");
  const [eventTime, setEventTime] = useState<EventTimeFilter>("all");
  const [feedNow, setFeedNow] = useState(Date.now);
  useEffect(() => {
    if (eventTime !== "now") return;
    const tick = () => setFeedNow(Date.now());
    tick();
    const timer = setInterval(tick, 1000);
    window.addEventListener("focus", tick);
    return () => { clearInterval(timer); window.removeEventListener("focus", tick); };
  }, [eventTime]);
  const [ownEventSection, setOwnEventSection] = useState<
    "upcoming" | "archive"
  >("upcoming");
  const latest = useRef(route),
    loadSequence = useRef(0),
    detailSequence = useRef(0);
  const knownCheckIns = useRef<{ userId: string; ids: Set<string> } | null>(null);
  const knownEventQueues = useRef<{ userId: string; ids: Set<string> } | null>(null);
  latest.current = route;
  const send = useCallback(
    async (path: string, method = "GET", body?: unknown): Promise<any> => {
      const multipart = body instanceof FormData;
      const response = await fetch(`/api/${path}`, {
        method,
        credentials: "same-origin",
        headers: {
          ...(body === undefined || multipart
            ? {}
            : { "Content-Type": "application/json" }),
          ...(["GET", "HEAD"].includes(method)
            ? {}
            : { "X-CSRFToken": csrfToken() }),
        },
        body:
          body === undefined
            ? undefined
            : multipart
              ? body
              : JSON.stringify(body),
      });
      const payload = await response
        .json()
        .catch(() => ({ error: "Сервер недоступен. Повторите действие." }));
      if (!response.ok) {
        if (response.status === 401) location.assign(signInPath());
        throw Object.assign(new ApiError(payload), { status: response.status });
      }
      return payload;
    },
    [],
  );
  const load = useCallback(async () => {
    const n = ++loadSequence.current;
    try {
      const next = await send("bootstrap");
      if (n === loadSequence.current) {
        if (user?.role === "participant") {
          const checkedIn = (next.tickets as FlowEvent[]).filter(
            (event) => event.checked_in,
          );
          const previous = knownCheckIns.current;
          if (previous?.userId === user.userId) {
            const entered = checkedIn.find((event) => !previous.ids.has(event.id));
            if (entered) {
              setToast({
                text: `Вы вошли в мероприятие «${entered.title}».`,
                error: false,
              });
            }
          }
          knownCheckIns.current = {
            userId: user.userId,
            ids: new Set(checkedIn.map((event) => event.id)),
          };
          const previousQueues = knownEventQueues.current;
          if (previousQueues?.userId === user.userId) {
            const promoted = (next.tickets as FlowEvent[]).find((event) => previousQueues.ids.has(event.id));
            if (promoted) setToast({ text: `Место освободилось! Вы зарегистрированы на мероприятие «${promoted.title}».`, error: false });
          }
          knownEventQueues.current = { userId: user.userId, ids: new Set(
            (next.events as FlowEvent[]).filter((event) => event.event_waitlisted).map((event) => event.id),
          ) };
        }
        setData(next);
        setError("");
      }
    } catch (e) {
      if (n === loadSequence.current) setError((e as Error).message);
    } finally {
      if (n === loadSequence.current) setLoading(false);
    }
  }, [send, user?.userId, user?.role]);
  const loadDetail = useCallback(
    async (id: string, attendance: "none" | "required" = "none") => {
      const n = ++detailSequence.current;
      try {
        const eventRequest: Promise<EventDetail> = send(`events/${id}`);
        const rowsRequest =
          attendance === "required"
            ? send(`events/${id}/attendance`)
            : Promise.resolve([]);
        const [next, attendees] = await Promise.all([
          eventRequest,
          rowsRequest,
        ]);
        if (n === detailSequence.current) {
          setDetail(next);
          setRows(attendees);
          setDetailError("");
        }
      } catch (e) {
        if (n === detailSequence.current) setDetailError((e as Error).message);
      }
    },
    [send],
  );
  const refresh = useCallback(async () => {
    await load();
    const r = latest.current;
    if (r.id && ["event", "webinar", "manage", "scan"].includes(r.view))
      await loadDetail(r.id, attendanceScope(r.view, organizer));
  }, [load, loadDetail, organizer]);
  const refreshInterval =
    user?.role === "participant" && ["profile", "event"].includes(route.view)
      ? 5000
      : 15000;
  useEffect(() => {
    const change = () => {
      if (location.hash === "#main-content") return;
      setRoute(routeFromHash(organizer));
      setDialog(null);
      void load();
    };
    window.addEventListener("hashchange", change);
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, refreshInterval);
    const focus = () => void refresh();
    window.addEventListener("focus", focus);
    return () => {
      window.removeEventListener("hashchange", change);
      window.removeEventListener("focus", focus);
      clearInterval(timer);
    };
  }, [load, organizer, refresh, refreshInterval]);
  useEffect(() => {
    detailSequence.current++;
    setDetail(null);
    setRows([]);
    setDetailError("");
    if (route.id && ["event", "webinar", "manage", "scan"].includes(route.view))
      void loadDetail(route.id, attendanceScope(route.view, organizer));
  }, [route, organizer, loadDetail]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  async function action(fn: () => Promise<unknown>, message: string | ((result: unknown) => string)) {
    if (!user) {
      location.assign(loginLink(route.view, route.id));
      return;
    }
    setPending(true);
    try {
      const result = await fn();
      await refresh();
      setToast({ text: typeof message === "function" ? message(result) : message, error: false });
    } catch (e) {
      setToast({ text: (e as Error).message, error: true });
    } finally {
      setPending(false);
    }
  }
  const save = (event: FlowEvent) =>
    void action(
      () =>
        send(
          `events/${event.id}/bookmark`,
          event.saved ? "DELETE" : "POST",
          event.saved ? undefined : {},
        ),
      event.saved ? "Убрали из избранного" : "Сохранили событие",
    );
  const enrollmentDone = (
    message = "Вы записаны. Событие добавлено в календарь.",
    result?: unknown,
    path = "",
  ) => {
    setDialog(null);
    void refresh();
    const immediate = /^events\/[^/]+\/waitlist$/.test(path) && (result as { registered?: boolean } | undefined)?.registered === true;
    setToast({ text: immediate ? "Место доступно! Вы зарегистрированы на мероприятие. Оно добавлено в календарь." : message, error: false });
  };
  async function enroll(
    event: FlowEvent,
    path = `events/${event.id}/registration`,
    message = hasWebinar(event)
      ? "Вы зарегистрированы. Войти в вебинар можно из карточки события или календаря."
      : "Вы зарегистрированы. Событие добавлено в календарь, QR — в профиле.",
  ) {
    if (!user) {
      location.assign(signupLink("event", event.id));
      return;
    }
    if (organizer) {
      setToast({
        text: "Запись на события доступна только участникам",
        error: true,
      });
      return;
    }
    if (pending) return;
    setPending(true);
    try {
      const result = await send(path, "POST", {});
      enrollmentDone(message, result, path);
    } catch (e) {
      if (e instanceof ApiError && e.code === "PROFILE_INCOMPLETE")
        setDialog({
          type: "enroll",
          event,
          path,
          missing: e.missing_fields,
          message,
        });
      else setToast({ text: (e as Error).message, error: true });
    } finally {
      setPending(false);
    }
  }
  const joinEventQueue = (event: FlowEvent) => void enroll(
    event, `events/${event.id}/waitlist`,
    "Вы в листе ожидания. При появлении места зарегистрируем вас автоматически и уведомим.",
  );
  const leaveEventQueue = (event: FlowEvent) => void action(
    () => send(`events/${event.id}/waitlist`, "DELETE"),
    (result) => (result as { registered?: boolean })?.registered
      ? "Вы уже получили место на мероприятии. Регистрация сохранена в календаре."
      : "Вы вышли из листа ожидания мероприятия",
  );
  const closeForm = (id?: string) => {
    setDialog(null);
    void refresh();
    if (id && dialog?.type === "create") go("manage", id);
    setToast({
      text:
        dialog?.type === "create"
          ? "Черновик создан. Проверьте данные и опубликуйте событие."
          : dialog?.type === "schedule"
            ? "Расписание обновлено. Участники уведомлены."
            : dialog?.type === "move"
              ? "Событие перенесено. Участники уведомлены."
              : "Сохранено",
      error: false,
    });
  };
  const activityEditorKey =
    dialog?.type === "activity" ? dialog.activity?.id ?? "new" : undefined;
  const activityEditor = dialog?.type === "activity" && detail ? (
    <ActivityForm
      key={activityEditorKey}
      detailsOnly={route.view === "manage"}
      event={detail.event}
      rooms={detail.rooms}
      activity={
        dialog.activity
          ? detail.activities.find((item) => item.id === dialog.activity?.id) ??
            dialog.activity
          : undefined
      }
      initialStart={
        dialog.range?.starts_at ??
        (() => {
          const lastEnd = Math.max(
            detail.event.starts_at,
            ...detail.activities.map((item) => item.ends_at),
          );
          return lastEnd < detail.event.ends_at
            ? lastEnd
            : detail.event.starts_at;
        })()
      }
      initialEnd={dialog.range?.ends_at}
      initialRoomId={dialog.range?.room_id}
      send={send}
      done={async () => {
        await refresh();
        setDialog(null);
        setToast({ text: "Сохранено", error: false });
      }}
    />
  ) : null;
  const own = data.events.filter((e) => e.owner_id === user?.userId);
  const catalogActivities = new Map<string, Activity[]>();
  for (const activity of data.activities ?? []) {
    const items = catalogActivities.get(activity.event_id) ?? [];
    items.push(activity);
    catalogActivities.set(activity.event_id, items);
  }
  const ownSections = splitOrganizerEvents(own);
  const visibleOwn = ownSections[ownEventSection];
  const catalogNow = eventTime === "now" ? feedNow : Date.now();
  const visible = data.events.filter(
    (e) =>
      e.status === "published" &&
      matchesEventTime(e, eventTime, catalogNow) &&
      (eventTime !== "visited" || !!user) &&
      (route.view !== "saved" || e.saved) &&
      (!query ||
        `${e.title} ${e.city} ${e.venue} ${e.topic}`
          .toLowerCase()
          .includes(query.toLowerCase())) &&
      (!city || e.city === city) &&
      (!topic || e.topic === topic) &&
      (!clubFilter ||
        (clubFilter === "@joined"
          ? data.communities.some(
              (club) => club.id === e.community_id && club.joined,
            )
          : e.community_id === clubFilter)) &&
      (!format || e.format === format) &&
      (!date ||
        new Date(e.starts_at + 3 * 3600000).toISOString().slice(0, 10) ===
          date),
  ).sort((a, b) => eventTime === "all"
    ? Number(a.ends_at <= catalogNow) - Number(b.ends_at <= catalogNow)
    : eventTime === "visited" ? b.starts_at - a.starts_at : 0);
  const hasFilters = !!(
    query.trim() ||
    city ||
    format ||
    date ||
    topic ||
    clubFilter ||
    eventTime !== "all"
  );
  const resetFilters = () => {
    setQuery("");
    setCity("");
    setFormat("");
    setDate("");
    setTopic("");
    setClubFilter("");
    setEventTime("all");
  };
  const clubsNav = { id: "clubs", name: "Клубы", icon: Heart };
  const calendarNav = { id: "calendar", name: "Календарь", icon: CalendarDays };
  const nav = organizerArea
    ? [
        { id: "organizer", name: "Мои события", icon: CalendarDays },
        clubsNav,
        calendarNav,
        { id: "scan", name: "Сканировать", icon: ScanLine },
        { id: "profile", name: "Профиль", icon: Users },
      ]
    : [
        { id: "events", name: "События", icon: Search },
        clubsNav,
        calendarNav,
        { id: "profile", name: "Профиль", icon: Users },
      ];
  const participantProfile =
    route.view === "profile" ||
    (route.view === "pass" && data.profile?.pass_token === route.id);
  const catalog = ["events", "saved"].includes(route.view);
  const denied =
    !organizer &&
    (["manage", "scan"].includes(route.view) ||
      (!!user && route.view === "organizer"));
  const brandDestination = organizerArea ? "organizer" : "events";
  const activeNav = (id: string) =>
    route.view === id ||
    (id === "clubs" && route.view === "communities") ||
    (id === "calendar" && route.view === "schedule") ||
    (organizer && id === "organizer" && route.view === "manage") ||
    (!organizerArea &&
      id === "events" &&
      ["event", "webinar"].includes(route.view)) ||
    (!organizerArea && id === "profile" && route.view === "pass");

  function activityAction(a: Activity, operation: ActivityAction) {
    const leaving = operation === "cancel" || operation === "leave";
    const queue = operation === "join" || operation === "leave";
    const message = {
      register: "Активность добавлена в программу",
      cancel: "Запись отменена",
      join: "Вы в листе ожидания. При появлении места запишем автоматически и уведомим вас.",
      leave: "Вы вышли из листа ожидания",
    }[operation];
    if (!leaving) {
      const event = data.events.find((event) => event.id === a.event_id);
      if (event) {
        void enroll(
          event,
          `activities/${a.id}/${queue ? "waitlist" : "registration"}`,
          message,
        );
        return;
      }
    }
    void action(
      () =>
        send(
          `activities/${a.id}/${queue ? "waitlist" : "registration"}`,
          leaving ? "DELETE" : "POST",
          leaving ? undefined : {},
        ),
      message,
    );
  }
  const programActions = {
    schedule: data.schedule,
    organizer,
    pending,
    onAction: activityAction,
    userId: user?.userId,
    webinarOwnerId: detail?.event.owner_id,
  };
  const webinarActivity = route.mode && route.mode !== "general"
    ? detail?.activities.find((activity) => activity.id === route.mode)
    : undefined;

  return (
    <div
      className={`flow-app ${organizerArea ? "organizer-app" : "participant-app"}`}
    >
      <a className="skip-link" href="#main-content">
        К содержимому
      </a>
      <header className="flow-topbar">
        <div className="flow-topbar-inner">
          <a
            className="brand"
            href={`#${brandDestination}`}
            aria-label="ТФлоу — главная"
          >
            <BrandLogo compactOnNarrow decorative />
          </a>
          <nav aria-label="Основная навигация" className="desktop-navigation">
            {nav.map((item) => (
              <a
                className={activeNav(item.id) ? "active" : ""}
                aria-current={activeNav(item.id) ? "page" : undefined}
                href={`#${item.id}`}
                key={item.id}
              >
                {item.name}
              </a>
            ))}
          </nav>
          <div className="flow-account">
            <ThemeToggle />
            {!user && (
              <a className="role-switch" href="#organizer">
                <LayoutDashboard size={18} />
                <span>Организаторам</span>
              </a>
            )}
            {user && !organizerArea && (
              <a
                className="icon-button favorite-link"
                href="#saved"
                aria-label="Избранное"
              >
                <Heart size={21} />
              </a>
            )}
            {user ? (
              <>
                <a
                  className="icon-button notification-link"
                  href="#notifications"
                  aria-label={
                    data.unread_notification_count
                      ? `Уведомления: ${data.unread_notification_count} непрочитанных`
                      : "Уведомления"
                  }
                >
                  <Bell size={20} />
                  {data.unread_notification_count > 0 && (
                    <span className="notification-count">
                      {data.unread_notification_count > 99
                        ? "99+"
                        : data.unread_notification_count}
                    </span>
                  )}
                </a>
                <AccountMenu
                  profile={
                    data.profile ?? { name: user.displayName, avatar_url: null }
                  }
                />
              </>
            ) : (
              <a className="button secondary small-button" href="/login/">
                Войти
              </a>
            )}
          </div>
        </div>
      </header>
      <main
        id="main-content"
        className={`flow-main ${["scan", "pass"].includes(route.view) ? "scanner-main" : ""}`}
      >
        {error && (
          <div className="page-error">
            <FormError error={error} />
            <button className="text-button" onClick={() => void refresh()}>
              Повторить
            </button>
          </div>
        )}
        {loading ? (
          <div className="loading-state" role="status">
            Загружаем…
          </div>
        ) : denied ? (
          <Empty
            title="Доступ только для организаторов"
            text={
              user
                ? "Вы вошли как участник. Роль выбирается при регистрации и не может быть изменена."
                : "Войдите в аккаунт организатора, чтобы управлять своими событиями."
            }
          >
            {user ? (
              <button className="button primary" onClick={() => go("events")}>
                К событиям
              </button>
            ) : (
              <a
                className="button primary"
                href={loginLink(route.view, route.id)}
              >
                Войти
              </a>
            )}
          </Empty>
        ) : (
          <>
            {catalog && (
              <>
                <Heading
                  title={route.view === "saved" ? "Избранное" : "Куда пойдём?"}
                  text={
                    route.view === "saved"
                      ? "События, к которым хочется вернуться"
                      : "Встречи, знания и люди рядом с вами"
                  }
                >
                  {!user && (
                    <a
                      className="button primary big-signup"
                      href={signupLink()}
                    >
                      Зарегистрироваться
                      <ArrowRight size={20} />
                    </a>
                  )}
                </Heading>
                <div className="discovery-tools">
                  <label className="discovery-search">
                    <Search size={22} />
                    <input
                      type="search"
                      aria-label="Найти событие"
                      placeholder="Событие, тема или город"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </label>
                  <button
                    className={`filter-button ${city || format || date ? "has-filters" : ""}`}
                    aria-label="Фильтры событий"
                    onClick={() => setDialog({ type: "filters" })}
                  >
                    <SlidersHorizontal size={20} />
                    <span>Фильтры</span>
                    {[city, format, date].filter(Boolean).length > 0 && (
                      <b>{[city, format, date].filter(Boolean).length}</b>
                    )}
                  </button>
                </div>
                <EventTimeFilterControl
                  value={eventTime}
                  onChange={setEventTime}
                />
                <div className="catalog-category-filter">
                  <CategorySelect value={topic} onChange={setTopic} allowAll />
                  {data.communities.length > 0 && (
                    <label className="catalog-club-filter">
                      Клуб
                      <select
                        value={clubFilter}
                        onChange={(event) => setClubFilter(event.target.value)}
                      >
                        <option value="">Все клубы</option>
                        {user && (
                          <option value="@joined">
                            Клубы, в которых я состою
                          </option>
                        )}
                        {data.communities.map((club) => (
                          <option key={club.id} value={club.id}>
                            {club.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
                <div className="discovery-count">
                  <span role="status">
                    {plural(visible.length, ["событие", "события", "событий"])}
                  </span>
                  {hasFilters && (
                    <button className="text-button" onClick={resetFilters}>
                      Сбросить всё
                      <X size={15} />
                    </button>
                  )}
                </div>
                {(city || format || date) && (
                  <div
                    className="active-filters"
                    aria-label="Выбранные фильтры"
                  >
                    {city && (
                      <button
                        onClick={() => setCity("")}
                        aria-label={`Убрать фильтр города ${city}`}
                      >
                        <MapPin size={14} />
                        {city}
                        <X size={14} />
                      </button>
                    )}
                    {format && (
                      <button
                        onClick={() => setFormat("")}
                        aria-label={`Убрать фильтр формата ${format}`}
                      >
                        {format}
                        <X size={14} />
                      </button>
                    )}
                    {date && (
                      <button
                        onClick={() => setDate("")}
                        aria-label="Убрать фильтр даты"
                      >
                        {new Date(`${date}T12:00:00`).toLocaleDateString(
                          "ru-RU",
                          { day: "numeric", month: "long" },
                        )}
                        <X size={14} />
                      </button>
                    )}
                  </div>
                )}
                {eventTime === "visited" && !user ? (
                  <Empty icon={CalendarDays} title="Ваша история посещений" text="Войдите, чтобы увидеть мероприятия с подтверждённым посещением.">
                    <a className="button primary" href="/login/?next=%2F%23events">Войти</a>
                  </Empty>
                ) : visible.length ? (
                  <div className="discovery-grid">
                    {visible.map((e) => (
                      <DiscoveryCard
                        event={e}
                        activities={user?.role === "participant" ? catalogActivities.get(e.id) ?? [] : undefined}
                        key={e.id}
                        onSave={() => save(e)}
                        userId={user?.userId}
                      />
                    ))}
                  </div>
                ) : eventTime === "visited" ? (
                  <Empty icon={CalendarDays} title="Пока нет подтверждённых посещений" text="После проверки QR на входе мероприятие появится здесь." />
                ) : eventTime === "now" ? (
                  <Empty icon={CalendarDays} title="Сейчас мероприятий нет" text="Здесь появятся события, когда наступит время их начала по расписанию." />
                ) : hasFilters ? (
                  <Empty
                    icon={Search}
                    title="Таких событий пока нет"
                    text="Попробуйте другой запрос или уберите фильтры."
                  >
                    <button className="button secondary" onClick={resetFilters}>
                      Сбросить поиск и фильтры
                    </button>
                  </Empty>
                ) : route.view === "saved" ? (
                  <Empty
                    icon={Heart}
                    title="Сохраните то, что интересно"
                    text="Нажмите на сердечко у события — оно появится здесь."
                  >
                    <button
                      className="button primary"
                      onClick={() => go("events")}
                    >
                      Посмотреть события
                      <ArrowRight size={17} />
                    </button>
                  </Empty>
                ) : (
                  <Empty
                    icon={CalendarDays}
                    title="События скоро появятся"
                    text="Организаторы ещё не опубликовали мероприятия. Загляните позже."
                  >
                    {!user && (
                      <a className="button secondary" href="#organizer">
                        Организаторам
                        <ArrowRight size={17} />
                      </a>
                    )}
                  </Empty>
                )}
              </>
            )}
            {route.view === "organizer" && organizer && user && (
              <>
                <Heading
                  title="Мои события"
                  text="Подготовка, участники и вход — всё здесь"
                >
                  {own.length > 0 && (
                    <button
                      className="button primary"
                      onClick={() => setDialog({ type: "create" })}
                    >
                      <Plus size={19} />
                      Создать событие
                    </button>
                  )}
                </Heading>
                <OrganizerTutorial
                  key={user.userId}
                  userId={user.userId}
                  events={own}
                  onAction={(action, event) => {
                    if (action === "create" || !event)
                      setDialog({ type: "create" });
                    else if (action === "schedule")
                      setDialog({ type: "schedule", event });
                    else if (action === "preview") go("event", event.id);
                    else if (action === "entry")
                      go(hasWebinar(event) ? "webinar" : "scan", event.id);
                    else
                      go(
                        "manage",
                        event.id,
                        action === "program" || action === "participants"
                          ? action
                          : undefined,
                      );
                  }}
                />
                {own.length > 0 ? (
                  <>
                    <div className="metric-grid overview-metrics">
                      <div>
                        <span>Событий</span>
                        <strong>{own.length}</strong>
                      </div>
                      <div>
                        <span>Регистраций</span>
                        <strong>
                          {own.reduce((n, e) => n + e.participant_count, 0)}
                        </strong>
                      </div>
                      <div>
                        <span>Уже вошли</span>
                        <strong>
                          {own.reduce((n, e) => n + e.checked_in_count, 0)}
                        </strong>
                      </div>
                    </div>
                    <div
                      className="segmented event-time-filter"
                      role="group"
                      aria-label="Разделы моих событий"
                    >
                      {(
                        [
                          ["upcoming", "Предстоящие"],
                          ["archive", "Архив"],
                        ] as const
                      ).map(([section, label]) => (
                        <button
                          type="button"
                          key={section}
                          className={
                            ownEventSection === section ? "selected" : ""
                          }
                          aria-pressed={ownEventSection === section}
                          onClick={() => setOwnEventSection(section)}
                        >
                          {label} · {ownSections[section].length}
                        </button>
                      ))}
                    </div>
                    <div className="host-events">
                      {visibleOwn.map((e) => (
                        <OrganizerEvent
                          event={e}
                          key={e.id}
                          onMove={() => setDialog({ type: "move", event: e })}
                          onDelete={() =>
                            setDialog({ type: "delete", event: e })
                          }
                        />
                      ))}
                      {visibleOwn.length === 0 && (
                        <Empty
                          title={
                            ownEventSection === "archive"
                              ? "Архив пока пуст"
                              : "Нет предстоящих событий"
                          }
                          text={
                            ownEventSection === "archive"
                              ? "После завершения мероприятия появятся здесь автоматически."
                              : "Прошедшие встречи находятся в архиве. Создайте новое событие, чтобы пригласить участников."
                          }
                        >
                          <button
                            className="button secondary"
                            onClick={() =>
                              ownEventSection === "archive"
                                ? setOwnEventSection("upcoming")
                                : setDialog({ type: "create" })
                            }
                          >
                            {ownEventSection === "archive"
                              ? "К предстоящим событиям"
                              : "Создать событие"}
                          </button>
                        </Empty>
                      )}
                    </div>
                  </>
                ) : (
                  <Empty
                    icon={CalendarDays}
                    title="Начните с вашей встречи"
                    text="Название, время и место — этого хватит для начала. Остальное можно добавить позже."
                  >
                    <button
                      className="button primary"
                      onClick={() => setDialog({ type: "create" })}
                    >
                      <Plus size={18} />
                      Создать событие
                    </button>
                  </Empty>
                )}
              </>
            )}
            {route.view === "organizer" && !user && <OrganizerIntro />}
            {route.view === "manage" && organizer && (
              <>
                <button className="back-link" onClick={() => go("organizer")}>
                  <ArrowLeft size={17} />
                  Мои события
                </button>
                {detailError ? (
                  <FormError error={detailError} />
                ) : detail ? (
                  <OrganizerManage
                    key={detail.event.id}
                    initialSection={
                      route.mode === "participants"
                        ? "participants"
                        : route.mode === "program"
                          ? "program"
                          : "event"
                    }
                    detail={detail}
                    busy={pending}
                    onOpenPublic={() => go("event", detail.event.id)}
                    onOpenWebinar={() => go("webinar", detail.event.id)}
                    rows={rows}
                    onScan={() => go("scan", detail.event.id)}
                    onMove={() =>
                      setDialog({ type: "move", event: detail.event })
                    }
                    onSchedule={() =>
                      setDialog({ type: "schedule", event: detail.event })
                    }
                    onCreate={() => setDialog({ type: "create" })}
                    onEdit={() =>
                      setDialog({ type: "edit", event: detail.event })
                    }
                    onDelete={() =>
                      setDialog({ type: "delete", event: detail.event })
                    }
                    onPublish={() =>
                      void action(
                        () =>
                          send(`events/${detail.event.id}/publish`, "POST", {}),
                        "Событие опубликовано",
                      )
                    }
                    onRoom={(room) => setDialog({ type: "room", room })}
                    onActivity={(activity, range) => {
                      const lastEnd = Math.max(
                        detail.event.starts_at,
                        ...detail.activities.map((item) => item.ends_at),
                      );
                      const start = lastEnd < detail.event.ends_at
                        ? lastEnd
                        : detail.event.starts_at;
                      setDialog({
                        type: "activity",
                        activity,
                        range: range ?? (activity ? undefined : {
                          starts_at: start,
                          ends_at: Math.min(start + 3600000, detail.event.ends_at),
                        }),
                      });
                    }}
                    activityEditor={activityEditor}
                    activityEditorKey={activityEditorKey}
                    onCloseActivity={() => setDialog(null)}
                    send={send}
                    refresh={refresh}
                  />
                ) : (
                  <div className="loading-state">Открываем событие…</div>
                )}
              </>
            )}
            {route.view === "scan" && organizer && (
              <>
                <button
                  className="back-link"
                  onClick={() =>
                    go(route.id ? "manage" : "organizer", route.id)
                  }
                >
                  <ArrowLeft size={17} />
                  {route.id ? "К событию" : "Мои события"}
                </button>
                <Heading
                  title="Проверка на входе"
                  text={
                    detail?.event.title ??
                    "Выберите событие и отсканируйте личный QR участника"
                  }
                />
                {detailError ? (
                  <FormError error={detailError} />
                ) : route.id && !detail ? (
                  <div className="loading-state">Загружаем…</div>
                ) : (
                  <QRScanner
                    key={route.id ?? "any"}
                    event={detail?.event}
                    events={own}
                    send={send}
                    onScan={() => void refresh()}
                  />
                )}
              </>
            )}
            {route.view === "pass" && !participantProfile && (
              <>
                {organizer ? (
                  <>
                    <Heading
                      title="Проверить участника"
                      text="Выберите ваше событие, чтобы подтвердить регистрацию"
                    />
                    <QRScanner
                      events={own}
                      initialToken={route.id}
                      send={send}
                      onScan={() => void refresh()}
                    />
                  </>
                ) : (
                  <Empty
                    title={
                      user
                        ? "Личный профиль участника"
                        : "Для просмотра нужно войти"
                    }
                    text={
                      user
                        ? "Данные доступны самому участнику и организатору его события."
                        : "Войдите в свой аккаунт, чтобы открыть QR."
                    }
                  >
                    {user ? (
                      <button
                        className="button primary"
                        onClick={() => go("profile")}
                      >
                        Мой QR
                      </button>
                    ) : (
                      <a
                        className="button primary"
                        href={loginLink("pass", route.id)}
                      >
                        Войти
                      </a>
                    )}
                  </Empty>
                )}
              </>
            )}
            {participantProfile && (
              <>
                {data.profile ? (
                  <ProfileView
                    profile={data.profile}
                    organizer={organizer}
                    events={data.events}
                    onCreate={() => setDialog({ type: "create" })}
                    onEdit={() => setDialog({ type: "profile" })}
                    onAvatar={() => setDialog({ type: "avatar" })}
                    pending={pending}
                    onLeaveEventWaitlist={leaveEventQueue}
                  />
                ) : (
                  <>
                    <Heading title="Ваш профиль" />
                    <Empty
                      title="Начнём со знакомства"
                      text="Зарегистрируйтесь — и ваш QR появится здесь."
                    >
                      <a
                        className="button primary big-signup"
                        href={signupLink("profile")}
                      >
                        Зарегистрироваться
                        <ArrowRight size={18} />
                      </a>
                      <a className="text-button" href={loginLink("profile")}>
                        Уже есть аккаунт? Войти
                      </a>
                    </Empty>
                  </>
                )}
              </>
            )}
            {route.view === "event" && (
              <>
                <button className="back-link" onClick={() => go("events")}>
                  <ArrowLeft size={17} />
                  Все события
                </button>
                {detailError ? (
                  <FormError error={detailError} />
                ) : !detail ? (
                  <div className="loading-state">Загружаем событие…</div>
                ) : (
                  <>
                    <div className="guest-event-layout">
                      <div className="guest-event-content">
                        <div className="guest-cover">
                          <EventArt cover={detail.event.cover} />
                        </div>
                        <div className="guest-event-title">
                          <span>
                            {detail.event.kind} · {detail.event.topic}
                          </span>
                          <h1>{detail.event.title}</h1>
                          <EventMeta event={detail.event} />
                        </div>
                        <section className="event-about">
                          <h2>О событии</h2>
                          <p>{detail.event.description}</p>
                          {detail.event.community_id && (
                            <button
                              className="event-club-link"
                              onClick={() =>
                                go("clubs", detail.event.community_id!)
                              }
                            >
                              <Users size={17} />
                              Клуб:{" "}
                              {data.communities.find(
                                (club) => club.id === detail.event.community_id,
                              )?.name ?? "Открыть клуб"}
                              <ArrowRight size={16} />
                            </button>
                          )}
                          <a
                            className="text-button event-calendar-link"
                            href={`/api/events/${detail.event.id}/calendar`}
                            download
                          >
                            <Download size={16} />
                            Добавить событие в календарь
                          </a>
                          <div className="event-host">
                            <span className="small-person-avatar">
                              {detail.event.organizer.slice(0, 1)}
                            </span>
                            <div>
                              <strong>{detail.event.organizer}</strong>
                              <span>Организатор</span>
                            </div>
                          </div>
                        </section>
                        <EventFlows
                          key={detail.event.id}
                          activities={detail.activities}
                          {...programActions}
                          onManage={organizer && detail.event.owner_id === user?.userId
                            ? () => go("manage", detail.event.id, "program")
                            : undefined}
                        />
                      </div>
                      <aside className="registration-card">
                        {user?.role === "participant" && !!detail.event.checked_in && (
                          <CheckInStatus event={detail.event} />
                        )}
                        <div className="price-line">
                          <strong>Бесплатно</strong>
                          <span>
                            {detail.event.enrolled
                              ? detail.event.checked_in
                                ? "Ваш вход подтверждён"
                                : "Ваше место забронировано"
                              : `${Math.max(0, detail.event.capacity - detail.event.participant_count)} мест осталось`}
                          </span>
                        </div>
                        {organizer && detail.event.owner_id === user?.userId ? (
                          <button
                            className="button primary"
                            onClick={() =>
                              go(
                                hasWebinar(detail.event) ? "webinar" : "manage",
                                detail.event.id,
                              )
                            }
                          >
                            {hasWebinar(detail.event)
                              ? "Открыть студию вебинара"
                              : "В кабинет организатора"}
                            <ArrowRight size={17} />
                          </button>
                        ) : organizer ? (
                          <p className="registration-role-note">
                            Запись доступна только аккаунтам участников. Вы
                            вошли как организатор.
                          </p>
                        ) : detail.event.enrolled ? (
                          <>
                            <button
                              className="button primary"
                              onClick={() =>
                                go(
                                  hasWebinar(detail.event)
                                    ? "webinar"
                                    : "profile",
                                  hasWebinar(detail.event)
                                    ? detail.event.id
                                    : undefined,
                                )
                              }
                            >
                              {["Онлайн", "Гибрид"].includes(
                                detail.event.format,
                              ) ? (
                                <>
                                  <Video size={20} />
                                  Войти в вебинар
                                </>
                              ) : (
                                <>
                                  <QrCode size={20} />
                                  Показать мой QR
                                </>
                              )}
                            </button>
                            <button
                              className="button danger-outline event-withdraw"
                              disabled={pending || !!detail.event.checked_in}
                              onClick={() =>
                                setDialog({
                                  type: "cancel",
                                  event: detail.event,
                                })
                              }
                            >
                              <X size={17} />
                              Отменить регистрацию
                            </button>
                            {!!detail.event.checked_in && (
                              <p className="withdraw-note">
                                Вход уже подтверждён — отмена регистрации
                                недоступна.
                              </p>
                            )}
                          </>
                        ) : user ? (
                          <EventRegistrationAction event={detail.event} profile={data.profile} pending={pending}
                            onRegister={() => void enroll(detail.event)} onJoin={() => joinEventQueue(detail.event)}
                            onLeave={() => leaveEventQueue(detail.event)} />
                        ) : (
                          <a
                            className="button primary register-event"
                            href={signupLink("event", detail.event.id)}
                          >
                            {detail.event.participant_count >= detail.event.capacity ? "Войти и встать в очередь" : "Зарегистрироваться"}
                            <ArrowRight size={18} />
                          </a>
                        )}
                        <p>
                          {detail.event.enrolled
                            ? hasWebinar(detail.event)
                              ? "Комната вебинара откроется прямо здесь, на ТФлоу."
                              : "Покажите QR из профиля на входе"
                            : detail.event.event_waitlisted ? "Вы пока ожидаете место — QR для этого события ещё недоступен."
                            : "После регистрации событие появится в календаре."}
                        </p>
                        {!detail.event.enrolled &&
                          detail.event.required_profile_fields?.length > 0 && (
                            <p className="required-data-note">
                              Для записи:{" "}
                              {REQUIREMENT_FIELDS.filter((f) =>
                                detail.event.required_profile_fields.includes(
                                  f.key as RequiredProfileField,
                                ),
                              )
                                .map((f) => f.label.toLowerCase())
                                .join(", ")}
                            </p>
                          )}
                        <div className="registration-facts">
                          <span>
                            <Clock3 size={17} />
                            {timeLabel(detail.event.starts_at)}–
                            {timeLabel(detail.event.ends_at)} · МСК
                          </span>
                          <span>
                            <MapPin size={17} />
                            {detail.event.address || detail.event.venue}
                          </span>
                        </div>
                      </aside>
                    </div>
                  </>
                )}
              </>
            )}
            {route.view === "webinar" && (
              <section className="webinar-room-page">
                <button
                  className="back-link"
                  onClick={() =>
                    go(
                      detail?.event.owner_id === user?.userId
                        ? "manage"
                        : "event",
                      route.id,
                    )
                  }
                >
                  <ArrowLeft size={17} />К событию
                </button>
                {detailError ? (
                  <FormError error={detailError} />
                ) : !detail ? (
                  <p className="loading-state">Открываем комнату вебинара…</p>
                ) : route.mode && route.mode !== "general" && !webinarActivity ? (
                  <Empty icon={Video} title="Флоу не найден" text="Откройте список активностей мероприятия и выберите нужный онлайн-флоу." />
                ) : !hasWebinar(detail.event) || (webinarActivity && !webinarActivity.room_is_online) ? (
                  <Empty
                    icon={MapPin}
                    title="Это очное событие"
                    text="Место встречи и программа указаны на странице события."
                  />
                ) : (
                  <>
                    <Heading
                      title={webinarActivity?.title ?? detail.event.title}
                      text={`${dateLabel(webinarActivity?.starts_at ?? detail.event.starts_at)} · ${timeLabel(webinarActivity?.starts_at ?? detail.event.starts_at)} МСК · ${detail.event.organizer}`}
                    />
                    {!user ? (
                      <Empty
                        icon={Video}
                        title="Войдите, чтобы открыть вебинар"
                        text="Мы проверим вашу регистрацию и откроем комнату встречи."
                      >
                        <a
                          className="button primary"
                          href={loginLink("webinar", detail.event.id)}
                        >
                          Войти в аккаунт
                          <ArrowRight size={18} />
                        </a>
                        <a
                          className="text-button"
                          href={signupLink("webinar", detail.event.id)}
                        >
                          Создать аккаунт
                        </a>
                      </Empty>
                    ) : organizer && detail.event.owner_id !== user.userId ? (
                      <Empty
                        icon={Video}
                        title="Это студия другого организатора"
                        text="Вы можете вести вебинары только своих событий. Просмотр доступен зарегистрированным участникам."
                      />
                    ) : !detail.event.enrolled &&
                      detail.event.owner_id !== user.userId ? (
                      <Empty
                        icon={Video}
                        title="Сначала зарегистрируйтесь"
                        text="Участие бесплатное. После регистрации здесь появится вход в комнату."
                      >
                        <button
                          className="button primary"
                          disabled={
                            pending ||
                            detail.event.status !== "published" ||
                            detail.event.ends_at < Date.now() ||
                            detail.event.participant_count >=
                              detail.event.capacity
                          }
                          onClick={() => enroll(detail.event)}
                        >
                          {pending
                            ? "Регистрируем…"
                            : detail.event.ends_at < Date.now()
                              ? "Событие завершено"
                              : detail.event.participant_count >=
                                  detail.event.capacity
                                ? "Мест больше нет"
                                : "Зарегистрироваться"}
                          <ArrowRight size={18} />
                        </button>
                      </Empty>
                    ) : webinarActivity && !organizer && !webinarActivity.registered ? (
                      <Empty icon={Video} title="Запишитесь на этот флоу" text="Для входа в отдельный вебинар нужна запись на его онлайн-активность.">
                        <ActivityProgram activities={[webinarActivity]} {...programActions} />
                      </Empty>
                    ) : !route.mode && detail.activities.some((activity) => activity.room_is_online) ? (
                      <WebinarChannels event={detail.event}
                        activities={detail.activities.filter((activity) => activity.room_is_online)} {...programActions} />
                    ) : (
                      <Suspense
                        fallback={
                          <p className="loading-state">
                            Готовим комнату эфира…
                          </p>
                        }
                      >
                        <Webinar
                          key={`${detail.event.id}/${webinarActivity?.id ?? "general"}`}
                          event={detail.event}
                          activity={webinarActivity}
                          user={user}
                          send={send}
                        />
                      </Suspense>
                    )}
                  </>
                )}
              </section>
            )}
            {["calendar", "schedule"].includes(route.view) && (
              <>
                {user ? (
                  <>
                    {!organizer && <EventWaitlists events={data.events} pending={pending} onLeave={leaveEventQueue} />}
                    <Calendar
                      data={data}
                      userId={user.userId}
                      initialDate={route.id}
                      initialView={route.mode}
                      canCreate={organizer}
                      onCreate={(startsAt) =>
                        setDialog({ type: "create", startsAt })
                      }
                      onBrowse={() => go("events")}
                      onCancelEvent={(event) =>
                        setDialog({ type: "cancel", event })
                      }
                      onCancelActivity={async (activityId) => {
                        await send(
                          `activities/${activityId}/registration`,
                          "DELETE",
                        );
                        await refresh();
                        setToast({
                          text: "Запись отменена. Расписание обновлено.",
                          error: false,
                        });
                      }}
                      onOpenEvent={(entry) =>
                        go(
                          entry.source === "owned" ? "manage" : "event",
                          entry.eventId,
                        )
                      }
                      onOpenWebinar={(event) => go("webinar", event.id)}
                    />
                    {(data.schedule.length > 0 || data.waitlist.length > 0) && (
                      <>
                        <Heading
                          title="Моя программа"
                          text="Ваши активности и очередь — в одном месте"
                        >
                          {data.schedule.length > 0 && (
                            <a
                              className="button secondary"
                              href="/api/schedule/calendar"
                              download
                            >
                              <Download size={17} />В календарь · .ics
                            </a>
                          )}
                        </Heading>
                        {data.schedule.length > 0 && (
                          <>
                            <p className="calendar-hint">
                              В файл войдут только подтверждённые активности с
                              напоминанием за 30 минут. После переноса скачайте
                              его заново — это разовый экспорт.
                            </p>
                            <ActivityProgram
                              personal
                              activities={data.schedule}
                              {...programActions}
                            />
                          </>
                        )}
                        {data.waitlist.length > 0 && (
                          <section className="personal-waitlist">
                            <div className="section-title">
                              <h2>Лист ожидания</h2>
                              <span>{data.waitlist.length}</span>
                            </div>
                            <p>
                              Место освободится — запишем вас автоматически и
                              уведомим. Если время будет занято, сохраним
                              очередь и пропустим следующего участника. Отмена
                              регистрации также убирает вас из очередей этого
                              события.
                            </p>
                            {data.waitlist.map((a) => (
                              <div className="waitlist-item" key={a.id}>
                                <p>
                                  {dateLabel(a.starts_at, { year: "numeric" })}
                                </p>
                                <ActivityCard
                                  activity={a}
                                  personal
                                  {...programActions}
                                />
                              </div>
                            ))}
                          </section>
                        )}
                      </>
                    )}
                  </>
                ) : (
                  <>
                    <Heading
                      title="Ваш календарь"
                      text="События и активности, на которые вы записались"
                    />
                    <Empty
                      icon={CalendarDays}
                      title="Все планы — в одном месте"
                      text="Войдите, чтобы видеть свои события в календаре месяца и расписание дня по часам."
                    >
                      <a
                        className="button primary"
                        href={loginLink("calendar")}
                      >
                        Войти
                        <ArrowRight size={17} />
                      </a>
                      <a className="text-button" href={signupLink("calendar")}>
                        Создать аккаунт
                      </a>
                    </Empty>
                  </>
                )}
              </>
            )}
            {route.view === "notifications" &&
              (user ? (
                <NotificationCenter
                  send={send}
                  unreadCount={data.unread_notification_count}
                  revision={`${data.notifications[0]?.id ?? ""}:${data.unread_notification_count}`}
                  onChange={load}
                  onOpen={(eventId) =>
                    go(eventId ? "event" : "calendar", eventId ?? undefined)
                  }
                />
              ) : (
                <Empty
                  icon={Bell}
                  title="Ваши уведомления"
                  text="Войдите, чтобы получать сообщения об отменах и изменениях ваших мероприятий."
                >
                  <a
                    className="button primary"
                    href={loginLink("notifications")}
                  >
                    Войти
                    <ArrowRight size={17} />
                  </a>
                </Empty>
              ))}
            {["clubs", "communities"].includes(route.view) && (
              <Clubs
                data={data}
                user={user}
                clubId={route.id}
                send={send}
                onChange={load}
                onOpenClub={(id) => go("clubs", id)}
                onOpenEvent={(event) =>
                  go(
                    event.owner_id === user?.userId ? "manage" : "event",
                    event.id,
                  )
                }
                onCreateEvent={(club) =>
                  setDialog({ type: "create", communityId: club.id })
                }
              />
            )}
            {route.view === "places" && (
              <>
                <Heading title="Площадки" />
                <div className="simple-directory">
                  {Array.from(
                    new Map(
                      data.events.map((event) => [event.venue, event]),
                    ).values(),
                  ).map((event) => (
                    <article key={event.venue}>
                      <MapPin size={25} />
                      <h2>{event.venue}</h2>
                      <p>
                        {event.city} · {event.address}
                      </p>
                      <button
                        className="button secondary"
                        onClick={() => {
                          setCity(event.city);
                          go("events");
                        }}
                      >
                        Смотреть события
                      </button>
                    </article>
                  ))}
                </div>
              </>
            )}
          </>
        )}
        <footer className="flow-footer">
          <span>ТФлоу · События и люди</span>
          <nav className="flow-footer-links" aria-label="Ссылки внизу страницы">
            {(!user || organizer) && (
              <a href="#organizer">
                {organizer ? "Кабинет организатора" : "Организаторам"}
              </a>
            )}
            <a href="#clubs">Клубы по интересам</a>
            <a href="#places">Площадки</a>
          </nav>
        </footer>
      </main>
      <nav
        className="mobile-bottom-nav"
        aria-label="Мобильная навигация"
        style={{ gridTemplateColumns: `repeat(${nav.length},minmax(0,1fr))` }}
      >
        {nav.map(({ id, name, icon: Icon }) => (
          <a
            className={activeNav(id) ? "active" : ""}
            aria-current={activeNav(id) ? "page" : undefined}
            aria-label={name}
            href={`#${id}`}
            key={id}
          >
            <Icon
              aria-hidden="true"
              size={23}
              strokeWidth={activeNav(id) ? 2 : 1.6}
            />
            <span>
              {id === "organizer" ? "События" : id === "scan" ? "Сканер" : name}
            </span>
          </a>
        ))}
      </nav>
      {toast && (
        <div
          className={`toast ${toast.error ? "toast-error" : ""}`}
          role={toast.error ? "alert" : "status"}
        >
          <span>{toast.text}</span>
          <button
            className="icon-button"
            aria-label="Закрыть уведомление"
            onClick={() => setToast(null)}
          >
            <X size={17} />
          </button>
        </div>
      )}
      {dialog &&
        ["create", "edit", "move", "schedule"].includes(dialog.type) && (
          <Modal
            title={
              dialog.type === "create"
                ? "Создать событие"
                : dialog.type === "schedule"
                  ? "Настройки расписания"
                  : dialog.type === "move"
                    ? "Перенести событие"
                    : "Изменить событие"
            }
            onClose={() => setDialog(null)}
          >
            <QuickEventForm
              initialStart={
                dialog.type === "create" ? dialog.startsAt : undefined
              }
              event={
                dialog.type === "edit" ||
                dialog.type === "move" ||
                dialog.type === "schedule"
                  ? dialog.event
                  : undefined
              }
              move={dialog.type === "move" || dialog.type === "schedule"}
              schedule={dialog.type === "schedule"}
              city={data.profile?.city || "Москва"}
              communities={data.communities.filter(
                (club) =>
                  club.joined ||
                  club.owner_id === user?.userId ||
                  ((dialog.type === "edit" ||
                    dialog.type === "move" ||
                    dialog.type === "schedule") &&
                    club.id === dialog.event.community_id),
              )}
              initialCommunityId={
                dialog.type === "create" ? dialog.communityId : undefined
              }
              send={send}
              done={closeForm}
            />
          </Modal>
        )}
      {dialog?.type === "avatar" && data.profile && (
        <Modal title="Фото профиля" onClose={() => setDialog(null)}>
          <AvatarForm
            profile={data.profile}
            send={send}
            done={() => closeForm()}
          />
        </Modal>
      )}
      {dialog?.type === "profile" && data.profile && (
        <Modal title="Редактировать профиль" onClose={() => setDialog(null)}>
          <ExpandedProfileForm
            profile={data.profile}
            send={send}
            done={() => closeForm()}
          />
        </Modal>
      )}
      {dialog?.type === "enroll" && data.profile && (
        <Modal
          title="Дополните данные для записи"
          onClose={() => setDialog(null)}
        >
          <CompleteRegistrationForm
            profile={data.profile}
            event={dialog.event}
            path={dialog.path}
            missing={dialog.missing}
            send={send}
            done={(result) => enrollmentDone(dialog.message, result, dialog.path)}
          />
        </Modal>
      )}
      {dialog?.type === "room" && detail && (
        <Modal
          title={dialog.room ? "Изменить аудиторию" : "Новая аудитория"}
          onClose={() => setDialog(null)}
        >
          <RoomForm
            eventId={detail.event.id}
            room={dialog.room}
            send={send}
            done={() => closeForm()}
          />
        </Modal>
      )}
      {dialog?.type === "activity" && detail && route.view !== "manage" && (
        <Modal
          title={
            dialog.activity
              ? "Изменить пункт программы"
              : "Добавить пункт программы"
          }
          wide
          onClose={() => setDialog(null)}
        >
          {activityEditor}
        </Modal>
      )}
      {dialog?.type === "filters" && (
        <Modal title="Фильтры" onClose={() => setDialog(null)}>
          <CatalogFilters
            cities={Array.from(new Set(data.events.map((e) => e.city)))}
            initial={{ city, date, format }}
            onApply={(values) => {
              setCity(values.city);
              setDate(values.date);
              setFormat(values.format);
              setDialog(null);
            }}
          />
        </Modal>
      )}
      {(dialog?.type === "cancel" || dialog?.type === "delete") && (
        <EventRemovalDialog
          event={dialog.event}
          deleting={dialog.type === "delete"}
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            const deleting = dialog.type === "delete";
            await send(
              `events/${dialog.event.id}${deleting ? "" : "/registration"}`,
              "DELETE",
            );
            setDialog(null);
            if (deleting) {
              go("organizer");
              await load();
            } else {
              await refresh();
            }
            setToast({
              text: deleting
                ? "Мероприятие удалено. Участники уведомлены."
                : "Регистрация отменена",
              error: false,
            });
          }}
        />
      )}
    </div>
  );
}
