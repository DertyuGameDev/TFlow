import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CalendarDays,
  Check,
  Clock3,
  MapPin,
  QrCode,
  Video,
  Users,
} from "lucide-react";
import type { FlowEvent } from "../../lib/types";
import { hasWebinar } from "../../lib/webinars";
import {
  ORGANIZER_LESSONS,
  readTutorialProgress,
  saveTutorialProgress,
  type GuideAction,
  type TutorialProgress,
} from "../../lib/organizer-tutorial";
import { Modal } from "./dialog";
import "../organizer-tutorial.css";

function LessonPreview({ step, online }: { step: number; online: boolean }) {
  return (
    <div
      className={`tutorial-preview tutorial-preview-${step}`}
      aria-hidden="true"
    >
      <span className="tutorial-example">Пример</span>
      {step === 0 && (
        <>
          <span className="tutorial-draft">Черновик</span>
          <strong className="tutorial-preview-title">Встреча о дизайне</strong>
          <div className="tutorial-example-field">
            <small>Название</small>
            <span>Встреча о дизайне</span>
          </div>
          <div className="tutorial-example-field">
            <small>Категория</small>
            <span>Искусство и дизайн</span>
          </div>
          <small className="tutorial-example-timezone">
            Черновик виден только вам
          </small>
        </>
      )}
      {step === 1 && (
        <>
          <CalendarDays size={26} />
          <strong className="tutorial-preview-title">Когда и где</strong>
          <div className="tutorial-example-times">
            <span>
              <small>Начало</small>10:00
            </span>
            <ArrowRight size={18} />
            <span>
              <small>Окончание</small>12:00
            </span>
          </div>
          <small className="tutorial-example-timezone">Время по МСК</small>
          <div className="tutorial-example-place">
            <MapPin size={17} />
            Городская библиотека
          </div>
        </>
      )}
      {step === 2 && (
        <>
          <Clock3 size={26} />
          <strong className="tutorial-preview-title">Флоу мероприятия</strong>
          <div className="tutorial-example-flow">
            {[
              { time: "10:00", title: "Открытие", live: false },
              { time: "10:30", title: "Лекция", live: true },
              { time: "11:15", title: "Практикум", live: false },
            ].map((item) => (
              <div
                className={`tutorial-flow-row ${item.live ? "is-live" : ""}`}
                key={item.time}
              >
                <span className="tutorial-flow-time">{item.time}</span>
                <span className="tutorial-flow-rail">
                  <i />
                </span>
                <div className="tutorial-flow-block">
                  {item.live && <small>Сейчас</small>}
                  <strong>{item.title}</strong>
                  <span>{item.live ? "Онлайн" : "Большой зал"}</span>
                </div>
              </div>
            ))}
          </div>
          <small className="tutorial-example-timezone">
            Название и время — в блоке
          </small>
        </>
      )}
      {step === 3 && (
        <>
          <span className="tutorial-published">
            <Check size={14} />
            Опубликовано
          </span>
          <strong className="tutorial-preview-title">Встреча о дизайне</strong>
          <div className="tutorial-example-poster">
            <CalendarDays size={32} />
            <span>10:00 · Библиотека</span>
          </div>
          <small className="tutorial-example-timezone">
            После публикации участники смогут записаться
          </small>
        </>
      )}
      {step === 4 && (
        <>
          <Users size={26} />
          <strong className="tutorial-preview-title">Участники</strong>
          <div className="tutorial-example-person">
            <b>А</b>
            <span>
              <strong>Анна Петрова</strong>
              <small>Записана на встречу</small>
            </span>
            <Check size={16} />
          </div>
          <small className="tutorial-example-timezone">
            Что спросить при записи
          </small>
          <div className="tutorial-example-tags">
            <span>Имя и почта</span>
            <span>Телефон</span>
          </div>
        </>
      )}
      {step === 5 && (
        <>
          {online ? (
            <Video className="tutorial-entry-icon" size={70} />
          ) : (
            <QrCode className="tutorial-entry-icon" size={82} />
          )}
          <strong className="tutorial-preview-title">
            {online ? "Студия вебинара" : "Проверка на входе"}
          </strong>
          <span className="tutorial-published">
            <Check size={14} />
            {online ? "Можно начать эфир" : "Участник зарегистрирован"}
          </span>
          <small className="tutorial-example-timezone">
            {online
              ? "Камера · Микрофон · Показ экрана"
              : "Один QR-код профиля"}
          </small>
        </>
      )}
    </div>
  );
}

export function OrganizerTutorial({
  userId,
  events,
  onAction,
  compact = false,
}: {
  userId: string;
  events: FlowEvent[];
  onAction: (action: GuideAction, event?: FlowEvent) => void;
  compact?: boolean;
}) {
  const [progress, setProgress] = useState(() => readTutorialProgress(userId));
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const lesson = ORGANIZER_LESSONS[progress.step];
  const target =
    events.find((event) => event.id === selectedId) ??
    events.find((event) => event.status === "draft") ??
    events.find((event) => event.ends_at > Date.now()) ??
    events[0];
  const welcome =
    !compact && !progress.started && !progress.dismissed && !progress.completed;
  const needsEvent = lesson.action !== "create";
  const entryLocked = lesson.action === "entry" && target?.status === "draft";
  const action: GuideAction =
    !target || !needsEvent
      ? "create"
      : entryLocked
        ? "overview"
        : lesson.action;
  const actionLabel =
    action === "create"
      ? "Создать черновик"
      : entryLocked
        ? "Подготовить событие"
        : lesson.action === "entry"
          ? target && hasWebinar(target)
            ? "Открыть студию"
            : "Сканировать QR"
          : lesson.actionLabel;

  function persist(next: TutorialProgress) {
    setProgress(next);
    saveTutorialProgress(userId, next);
  }
  function show() {
    persist({
      ...progress,
      step: progress.completed ? 0 : progress.step,
      started: true,
    });
    setOpen(true);
  }
  function changeStep(step: number) {
    persist({ ...progress, step });
    if (step === progress.step) {
      heading.current?.focus({ preventScroll: true });
      heading.current?.closest("dialog")?.scrollTo({ top: 0 });
    }
  }
  function finish() {
    persist({ ...progress, completed: true });
    setOpen(false);
  }
  useEffect(() => {
    if (open) {
      heading.current?.focus({ preventScroll: true });
      heading.current?.closest("dialog")?.scrollTo({ top: 0 });
    }
  }, [open, progress.step]);

  return (
    <>
      {welcome ? (
        <section
          className="tutorial-welcome"
          aria-label="Обучение организатора"
        >
          <div className="tutorial-welcome-icon">
            <BookOpen size={24} />
          </div>
          <div>
            <h2>Проведите своё первое событие</h2>
            <p>
              Шесть коротких шагов: от черновика до встречи с участниками. Можно
              проходить в своём темпе.
            </p>
          </div>
          <div className="tutorial-welcome-actions">
            <button className="button primary" onClick={show}>
              Начать обучение
              <ArrowRight size={17} />
            </button>
            <button
              className="text-button"
              onClick={() => persist({ ...progress, dismissed: true })}
            >
              Позже
            </button>
          </div>
        </section>
      ) : (
        <div className={compact ? "tutorial-compact" : "tutorial-launch"}>
          <button className="text-button tutorial-help-button" onClick={show}>
            <BookOpen size={17} />
            {compact
              ? "Инструкция"
              : progress.started && !progress.completed
                ? "Продолжить обучение"
                : "Инструкция организатора"}
          </button>
          {!compact && progress.completed && (
            <small>
              <Check size={14} />
              Обучение пройдено
            </small>
          )}
        </div>
      )}
      {open && (
        <Modal
          title="Инструкция организатора"
          onClose={() => setOpen(false)}
          wide
          initialFocusRef={heading}
        >
          <div className="organizer-tutorial">
            <nav className="tutorial-steps" aria-label="Шаги обучения">
              {ORGANIZER_LESSONS.map((step, index) => (
                <button
                  key={step.label}
                  aria-label={`Шаг ${index + 1}: ${step.label}`}
                  aria-current={progress.step === index ? "step" : undefined}
                  onClick={() => changeStep(index)}
                >
                  <span>{index + 1}</span>
                  <small>{step.label}</small>
                </button>
              ))}
            </nav>
            <div className="tutorial-content">
              <LessonPreview
                step={progress.step}
                online={target ? hasWebinar(target) : false}
              />
              <section
                className="tutorial-lesson"
                aria-labelledby="tutorial-step-title"
              >
                <p className="tutorial-step-counter" aria-live="polite">
                  Шаг {progress.step + 1} из {ORGANIZER_LESSONS.length}
                </p>
                <h3 id="tutorial-step-title" tabIndex={-1} ref={heading}>
                  {lesson.title}
                </h3>
                <p className="tutorial-description">{lesson.description}</p>
                <ol>
                  {lesson.tips.map((tip) => (
                    <li key={tip}>{tip}</li>
                  ))}
                </ol>
              </section>
            </div>
            <div className="tutorial-practice">
              <strong>Попробуйте на своём событии</strong>
              <div className="tutorial-practice-controls">
                {needsEvent && events.length > 1 ? (
                  <label>
                    <span className="sr-only">Событие для обучения</span>
                    <select
                      value={target?.id ?? ""}
                      onChange={(e) => setSelectedId(e.target.value)}
                    >
                      {events.map((event) => (
                        <option value={event.id} key={event.id}>
                          {event.title}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : needsEvent && target ? (
                  <p>{target.title}</p>
                ) : (
                  <p>Обучение можно продолжить после сохранения черновика.</p>
                )}
                <button
                  className="button primary"
                  onClick={() => {
                    setOpen(false);
                    onAction(action, target);
                  }}
                >
                  {actionLabel}
                  <ArrowRight size={16} />
                </button>
              </div>
              {entryLocked && (
                <small>Проверка входа и эфир доступны после публикации.</small>
              )}
            </div>
            <footer className="tutorial-footer">
              <button
                className="button secondary"
                disabled={progress.step === 0}
                onClick={() => changeStep(progress.step - 1)}
              >
                <ArrowLeft size={16} />
                Назад
              </button>
              {progress.step < ORGANIZER_LESSONS.length - 1 ? (
                <button
                  className="button primary"
                  onClick={() => changeStep(progress.step + 1)}
                >
                  Далее
                  <ArrowRight size={16} />
                </button>
              ) : (
                <button
                  className="button primary"
                  onClick={finish}
                  aria-label="Завершить обучение"
                >
                  Готово
                  <Check size={17} />
                </button>
              )}
            </footer>
            <p className="tutorial-resume-hint">
              Можно закрыть инструкцию и вернуться к этому шагу позже.
            </p>
          </div>
        </Modal>
      )}
    </>
  );
}
