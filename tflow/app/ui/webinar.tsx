import { useEffect, useRef, useState } from "react";
import {
  LogOut,
  Maximize,
  Mic,
  MicOff,
  MonitorUp,
  Play,
  Send as SendIcon,
  Square,
  Users,
  Video,
  VideoOff,
  Volume2,
} from "lucide-react";
import {
  Room,
  RoomEvent,
  Track,
  setLogLevel,
  LogLevel,
  type Participant,
} from "livekit-client";
import type { FlowEvent, UserIdentity } from "../../lib/types";
import { FormError, type Send } from "./forms";
import { Modal } from "./dialog";
import "../webinar.css";

type Status = {
  configured: boolean;
  host: boolean;
  active: boolean;
  session: string | null;
  ended: boolean;
  published: boolean;
  finished?: boolean;
};
type Access = { url: string; token: string; host: boolean; session: string };
type ChatMessage = {
  identity?: string;
  id: string;
  author: string;
  text: string;
  own: boolean;
};
function Media({ track, muted = false }: { track: Track; muted?: boolean }) {
  const element = useRef<HTMLMediaElement>(null);
  useEffect(() => {
    const target = element.current;
    if (!target) return;
    track.attach(target);
    return () => {
      track.detach(target);
    };
  }, [track]);
  return track.kind === Track.Kind.Video ? (
    <video
      ref={element as React.RefObject<HTMLVideoElement>}
      autoPlay
      playsInline
      muted={muted}
    />
  ) : (
    <audio ref={element as React.RefObject<HTMLAudioElement>} autoPlay />
  );
}

export default function Webinar({
  event,
  user,
  send,
}: {
  event: FlowEvent;
  user: UserIdentity;
  send: Send;
}) {
  const roomRef = useRef<Room | null>(null),
    session = useRef<string | null>(null),
    alive = useRef(true),
    statusSequence = useRef(0),
    connecting = useRef(false);
  const stage = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status | null>(null),
    [connected, setConnected] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [tick, setTick] = useState(0),
    [confirmEnd, setConfirmEnd] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]),
    [draft, setDraft] = useState(""),
    [chatBusy, setChatBusy] = useState(false),
    [audioBlocked, setAudioBlocked] = useState(false);
  const host = event.owner_id === user.userId;
  function update() {
    if (alive.current) setTick((value) => value + 1);
  }
  async function leave() {
    const current = roomRef.current;
    roomRef.current = null;
    session.current = null;
    await current?.disconnect();
    if (alive.current) {
      setConnected(false);
      setAudioBlocked(false);
      update();
    }
  }
  async function loadStatus() {
    const sequence = ++statusSequence.current;
    try {
      const next = (await send(`events/${event.id}/webinar`, "GET")) as Status;
      if (!alive.current || sequence !== statusSequence.current) return;
      setStatus(next);
      if (roomRef.current && (!next.active || session.current !== next.session))
        await leave();
    } catch (cause) {
      if (alive.current && sequence === statusSequence.current) {
        setError((cause as Error).message);
        const code = (cause as Error & { status?: number }).status;
        if (code === 401 || code === 403 || code === 404) {
          setStatus(null);
          await leave();
        }
      }
    }
  }
  useEffect(() => {
    alive.current = true;
    setLogLevel(LogLevel.error);
    void loadStatus();
    const timer = setInterval(() => void loadStatus(), 5000);
    return () => {
      alive.current = false;
      statusSequence.current++;
      clearInterval(timer);
      void roomRef.current?.disconnect();
      roomRef.current = null;
    };
  }, [event.id, send]);
  function receive(
    payload: Uint8Array,
    participant?: Participant,
    _kind?: unknown,
    topic?: string,
    _encryption?: unknown,
    participantIdentity?: string,
  ) {
    if (topic !== "tflow-chat" || payload.byteLength > 4096) return;
    try {
      const parsed = JSON.parse(new TextDecoder().decode(payload));
      if (
        typeof parsed.text !== "string" ||
        !parsed.text.trim() ||
        parsed.text.length > 1000
      )
        return;
      setMessages((current) =>
        [
          ...current,
          {
            id: crypto.randomUUID(),
            identity: participant?.identity ?? participantIdentity,
            author:
              participant?.name ||
              roomRef.current?.remoteParticipants.get(participantIdentity ?? "")
                ?.name ||
              "Участник",
            text: parsed.text,
            own: false,
          },
        ].slice(-100),
      );
    } catch {}
  }
  async function connect() {
    if (connecting.current || roomRef.current) return;
    connecting.current = true;
    setBusy(true);
    setError("");
    setMessages([]);
    statusSequence.current++;
    let room: Room | null = null;
    try {
      const access = (await send(`events/${event.id}/webinar`, "POST", {
        operation: host ? "start" : "join",
      })) as Access;
      if (!alive.current) return;
      room = new Room({ adaptiveStream: true, dynacast: true });
      roomRef.current = room;
      session.current = access.session;
      room
        .on(RoomEvent.TrackSubscribed, update)
        .on(RoomEvent.TrackUnsubscribed, update)
        .on(RoomEvent.LocalTrackPublished, update)
        .on(RoomEvent.LocalTrackUnpublished, update)
        .on(RoomEvent.TrackMuted, update)
        .on(RoomEvent.TrackUnmuted, update)
        .on(RoomEvent.ParticipantConnected, update)
        .on(RoomEvent.ParticipantDisconnected, update)
        .on(RoomEvent.DataReceived, receive)
        .on(RoomEvent.AudioPlaybackStatusChanged, () =>
          setAudioBlocked(!room!.canPlaybackAudio),
        );
      room.on(RoomEvent.Disconnected, () => {
        if (alive.current && roomRef.current === room) {
          roomRef.current = null;
          session.current = null;
          setConnected(false);
          update();
          void loadStatus();
        }
      });
      await room.connect(access.url, access.token);
      if (!alive.current || roomRef.current !== room) {
        await room.disconnect();
        return;
      }
      setConnected(true);
      setStatus({
        configured: true,
        host,
        active: true,
        session: access.session,
        ended: false,
        published: true,
      });
      update();
      if (host) {
        const results = await Promise.allSettled([
          room.localParticipant.setCameraEnabled(true),
          room.localParticipant.setMicrophoneEnabled(true),
        ]);
        if (
          alive.current &&
          results.some((result) => result.status === "rejected")
        )
          setError(
            "Не удалось включить камеру или микрофон. Разрешите доступ в браузере или включите устройство кнопкой ниже.",
          );
        update();
      }
    } catch (cause) {
      if (room) await room.disconnect();
      if (alive.current) {
        roomRef.current = null;
        session.current = null;
        setConnected(false);
        setError(
          cause instanceof Error &&
            !(
              cause.message.includes("token") ||
              cause.message.includes("wss:") ||
              cause.message.includes("ws:")
            )
            ? cause.message
            : "Не удалось подключиться к эфиру. Проверьте соединение и повторите попытку.",
        );
      }
    } finally {
      connecting.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function control(kind: "camera" | "microphone" | "screen") {
    const room = roomRef.current;
    if (!room || busy) return;
    setBusy(true);
    setError("");
    try {
      const local = room.localParticipant;
      if (kind === "camera")
        await local.setCameraEnabled(!local.isCameraEnabled);
      else if (kind === "microphone")
        await local.setMicrophoneEnabled(!local.isMicrophoneEnabled);
      else
        await local.setScreenShareEnabled(!local.isScreenShareEnabled, {
          audio: true,
        });
    } catch {
      setError(
        "Не удалось включить устройство или показ экрана. Проверьте разрешения браузера.",
      );
    } finally {
      setBusy(false);
      update();
    }
  }
  async function end() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await send(`events/${event.id}/webinar`, "POST", { operation: "end" });
      await leave();
      setConfirmEnd(false);
      await loadStatus();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function chat(event: React.FormEvent) {
    event.preventDefault();
    const room = roomRef.current,
      text = draft.trim();
    if (!room || !text || chatBusy) return;
    setChatBusy(true);
    try {
      await room.localParticipant.publishData(
        new TextEncoder().encode(JSON.stringify({ text })),
        { reliable: true, topic: "tflow-chat" },
      );
      setMessages((current) =>
        [
          ...current,
          {
            id: crypto.randomUUID(),
            author: user.displayName,
            text,
            own: true,
          },
        ].slice(-100),
      );
      setDraft("");
    } catch {
      setError("Не удалось отправить сообщение. Повторите попытку.");
    } finally {
      setChatBusy(false);
    }
  }
  const room = roomRef.current;
  const presenter = host
    ? room?.localParticipant
    : room?.remoteParticipants.get(event.owner_id);
  const screen = presenter?.getTrackPublication(
    Track.Source.ScreenShare,
  )?.track;
  const camera = presenter?.getTrackPublication(Track.Source.Camera)?.track;
  const main = screen ?? (presenter?.isCameraEnabled ? camera : undefined);
  const audio = host
    ? []
    : [...(presenter?.audioTrackPublications.values() ?? [])]
        .map((publication) => publication.track)
        .filter((track): track is NonNullable<typeof track> => !!track);
  void tick;
  return (
    <section
      id={`webinar-${event.id}`}
      className="webinar-panel"
      aria-label="Вебинар события"
    >
      <header className="webinar-heading">
        <div>
          <span className={`webinar-state ${status?.active ? "is-live" : ""}`}>
            {status?.active ? "● В эфире" : "Онлайн на ТФлоу"}
          </span>
          <h2>{host ? "Ваш вебинар" : "Вебинар события"}</h2>
          <p>
            {host
              ? "Вы ведёте эфир, участники смотрят и задают вопросы в чате."
              : "Смотрите выступление и задавайте вопросы ведущему в чате."}
          </p>
        </div>
        {connected && (
          <span className="webinar-viewers">
            <Users size={17} />
            {host ? "Вы ведёте эфир" : "Вы смотрите эфир"}
          </span>
        )}
      </header>
      <FormError error={error} />
      {!connected ? (
        <div className="webinar-lobby">
          <Video size={35} />
          <h3>
            {!status
              ? "Проверяем эфир…"
              : status.ended || (status.finished && !host)
                ? "Эфир завершён"
                : host
                  ? "Всё готово для вашей встречи"
                  : status?.active
                    ? "Организатор уже в эфире"
                    : "Ожидаем начало эфира"}
          </h3>
          <p>
            {!status
              ? "Подождите несколько секунд."
              : !status.configured
                ? "Сервис трансляций ещё не подключён. Организатор сможет начать эфир после его подключения."
                : !status.published
                  ? "Сначала опубликуйте событие, затем начните эфир."
                  : status.ended
                    ? "Событие завершилось."
                    : status.finished
                      ? host
                        ? "Предыдущий эфир завершён. Вы можете начать новую трансляцию."
                        : "Ведущий завершил эфир."
                      : host
                        ? "Камеру и микрофон можно включать и выключать во время выступления."
                        : status?.active
                          ? "Ваши камера и микрофон останутся выключенными."
                          : "Когда организатор начнёт эфир, кнопка входа станет доступна."}
          </p>
          <button
            className="button primary"
            disabled={
              busy ||
              !status?.configured ||
              !status?.published ||
              status?.ended ||
              (!host && !status?.active)
            }
            onClick={() => void connect()}
          >
            <Play size={18} />
            {busy
              ? "Подключаемся…"
              : host
                ? status?.active
                  ? "Вернуться в эфир"
                  : status?.finished
                    ? "Начать новый эфир"
                    : "Начать эфир"
                : "Войти в вебинар"}
          </button>
        </div>
      ) : (
        <div className="webinar-layout">
          <div className="webinar-broadcast">
            <div
              className={`webinar-stage ${screen ? "is-screen" : ""}`}
              ref={stage}
            >
              {main ? (
                <Media track={main} muted={host} />
              ) : (
                <div className="webinar-camera-off">
                  <VideoOff size={36} />
                  <strong>
                    {host ? "Камера выключена" : "Ожидаем видео ведущего"}
                  </strong>
                  <span>
                    {host
                      ? "Можно включить камеру, звук или показать экран."
                      : "Звук и чат доступны, даже когда камера выключена."}
                  </span>
                </div>
              )}
              {screen && camera && presenter?.isCameraEnabled && (
                <div className="webinar-presenter-preview">
                  <Media track={camera} muted={host} />
                </div>
              )}
              {audio.map((track) => (
                <Media key={track.sid} track={track} />
              ))}
              <button
                className="webinar-fullscreen"
                aria-label="На весь экран"
                onClick={() =>
                  void stage.current
                    ?.requestFullscreen()
                    .catch(() =>
                      setError(
                        "Полноэкранный режим недоступен в этом браузере.",
                      ),
                    )
                }
              >
                <Maximize size={18} />
              </button>
            </div>
            {audioBlocked && (
              <button
                className="button secondary"
                onClick={() => void room?.startAudio()}
              >
                <Volume2 size={18} />
                Включить звук
              </button>
            )}
            <div className="webinar-controls">
              {host && (
                <>
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => void control("microphone")}
                  >
                    {room?.localParticipant.isMicrophoneEnabled ? (
                      <Mic size={18} />
                    ) : (
                      <MicOff size={18} />
                    )}
                    <span>
                      {room?.localParticipant.isMicrophoneEnabled
                        ? "Выключить микрофон"
                        : "Включить микрофон"}
                    </span>
                  </button>
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => void control("camera")}
                  >
                    {room?.localParticipant.isCameraEnabled ? (
                      <Video size={18} />
                    ) : (
                      <VideoOff size={18} />
                    )}
                    <span>
                      {room?.localParticipant.isCameraEnabled
                        ? "Выключить камеру"
                        : "Включить камеру"}
                    </span>
                  </button>
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => void control("screen")}
                  >
                    <MonitorUp size={18} />
                    <span>
                      {room?.localParticipant.isScreenShareEnabled
                        ? "Остановить показ"
                        : "Показать экран"}
                    </span>
                  </button>
                </>
              )}
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => void leave()}
              >
                <LogOut size={18} />
                Выйти из комнаты
              </button>
              {host && (
                <button
                  className="button danger-outline"
                  disabled={busy}
                  onClick={() => setConfirmEnd(true)}
                >
                  <Square size={16} />
                  Завершить эфир
                </button>
              )}
            </div>
          </div>
          <aside className="webinar-chat">
            <h3>Чат эфира</h3>
            <p className="webinar-chat-hint">Сообщения текущего подключения</p>
            <div
              className="webinar-messages"
              aria-label="Сообщения эфира"
              aria-live="polite"
            >
              {messages.length ? (
                messages.map((message) => (
                  <div
                    className={`webinar-message ${message.own ? "own" : ""}`}
                    key={message.id}
                  >
                    <strong>
                      {room?.remoteParticipants.get(message.identity ?? "")
                        ?.name || message.author}
                    </strong>
                    <p>{message.text}</p>
                  </div>
                ))
              ) : (
                <p className="webinar-chat-empty">
                  Задавайте вопросы ведущему и общайтесь с участниками.
                </p>
              )}
            </div>
            <form onSubmit={(event) => void chat(event)}>
              <label>
                <span className="sr-only">Сообщение в чат</span>
                <textarea
                  rows={2}
                  maxLength={1000}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="Ваш вопрос или сообщение"
                />
              </label>
              <button
                className="button primary"
                disabled={chatBusy || !draft.trim()}
              >
                <SendIcon size={16} />
                Отправить
              </button>
            </form>
          </aside>
        </div>
      )}
      {confirmEnd && (
        <Modal
          title="Завершить эфир для всех?"
          dismissible={!busy}
          onClose={() => setConfirmEnd(false)}
        >
          <p className="confirmation-copy">
            Трансляция остановится у всех зрителей. При необходимости вы сможете
            начать новый эфир этого события.
          </p>
          <FormError error={error} />
          <div className="confirmation-actions">
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => setConfirmEnd(false)}
            >
              Продолжить эфир
            </button>
            <button
              className="button danger-button"
              disabled={busy}
              onClick={() => void end()}
            >
              {busy ? "Завершаем…" : "Да, завершить эфир"}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
