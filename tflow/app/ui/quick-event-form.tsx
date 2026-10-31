import { useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Video } from "lucide-react";
import { CITIES, type FlowEvent, type Community } from "../../lib/types";
import { fromLocalInput, localInput } from "../../lib/time";
import { FormError, Submit, useSubmit, type Send } from "./forms";
import { CityPicker } from "./city-picker";
import { CategorySelect } from "./category-select";
import "../event-form.css";

const EVENT_KINDS = [
  "Встреча",
  "Лекция",
  "Мастер-класс",
  "Митап",
  "Конференция",
  "Хакатон",
  "Практикум",
  "Концерт",
  "Выставка",
  "Фестиваль",
  "Экскурсия",
  "Тренировка",
  "Турнир",
  "Квиз",
];

export function QuickEventForm({
  event,
  move = false,
  schedule = false,
  city = "Москва",
  initialStart,
  communities = [],
  initialCommunityId,
  send,
  done,
}: {
  event?: FlowEvent;
  move?: boolean;
  schedule?: boolean;
  city?: string;
  initialStart?: number;
  communities?: Community[];
  initialCommunityId?: string;
  send: Send;
  done: (id?: string) => void;
}) {
  const form = useRef<HTMLFormElement>(null);
  const [step, setStep] = useState(move ? 1 : 0);
  const start = event?.starts_at ?? initialStart ?? Date.now() + 86400000;
  const [startValue, setStartValue] = useState(localInput(start));
  const [endValue, setEndValue] = useState(
    localInput(event?.ends_at ?? start + 2 * 3600000),
  );
  const [format, setFormat] = useState(event?.format ?? "Очно");
  const [selectedCity, setSelectedCity] = useState(
    event?.city && event.city !== "Онлайн" ? event.city : city,
  );
  const [physicalVenue, setPhysicalVenue] = useState(
    event?.format !== "Онлайн" ? (event?.venue ?? "") : "",
  );
  const [physicalAddress, setPhysicalAddress] = useState(
    event?.format !== "Онлайн" ? (event?.address ?? "") : "",
  );
  const previousStart = useRef(start);
  const online = format === "Онлайн";
  const scheduleUnchanged =
    schedule &&
    event &&
    startValue === localInput(event.starts_at) &&
    endValue === localInput(event.ends_at) &&
    (online ||
      (selectedCity === event.city &&
        physicalVenue.trim() === event.venue &&
        physicalAddress.trim() === (event.address ?? "")));
  function changeStart(value: string) {
    setStartValue(value);
    const next = fromLocalInput(value);
    if (!Number.isFinite(next)) return;
    const delta = next - previousStart.current;
    previousStart.current = next;
    setEndValue((current) => {
      const end = fromLocalInput(current);
      return Number.isFinite(end) ? localInput(end + delta) : current;
    });
  }
  function showStep(next: number) {
    setStep(next);
    form.current?.closest("dialog")?.scrollTo({ top: 0 });
  }
  function validate(all = false) {
    const scope = all
      ? form.current
      : form.current?.querySelector(`[data-form-step="${step}"]`);
    const invalid = Array.from(
      scope?.querySelectorAll<
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
      >("input, select, textarea") ?? [],
    ).find((input) => !input.checkValidity());
    if (!invalid) return true;
    const targetStep = Number(
      invalid.closest<HTMLElement>("[data-form-step]")?.dataset.formStep ??
        step,
    );
    setStep(targetStep);
    requestAnimationFrame(() => invalid.reportValidity());
    return false;
  }
  function next() {
    if (validate()) showStep(1);
  }
  const { submit, error, busy } = useSubmit(async (data) => {
    const dates = {
      starts_at: fromLocalInput(String(data.get("starts_at"))),
      ends_at: fromLocalInput(String(data.get("ends_at"))),
      city: String(data.get("city") ?? selectedCity),
      venue: String(data.get("venue") ?? "").trim(),
      address: String(data.get("address") ?? "").trim(),
    };
    if (move && event) {
      await send(`events/${event.id}/move`, "PATCH", dates);
      done(event.id);
      return;
    }
    const title = String(data.get("title") ?? "").trim();
    const result = (await send(
      event ? `events/${event.id}` : "events",
      event ? "PATCH" : "POST",
      {
        ...dates,
        title,
        description:
          String(data.get("description") ?? "").trim() ||
          `Информация о мероприятии «${title}».`,
        capacity: Number(data.get("capacity") || 100),
        format,
        topic: data.get("topic"),
        kind: data.get("kind") || "Встреча",
        cover: event?.cover ?? "yellow",
        community_id: data.get("community_id") || null,
      },
    )) as { id?: string };
    done(result.id ?? event?.id);
  });
  return (
    <form
      ref={form}
      className="flow-form quick-event-form event-wizard"
      noValidate
      onSubmit={(event) => {
        if (!move && step === 0) {
          event.preventDefault();
          next();
          return;
        }
        if (!validate(true)) {
          event.preventDefault();
          return;
        }
        void submit(event);
      }}
    >
      {!move && (
        <>
          <p className="event-form-intro">
            {event
              ? "Изменения сохранятся в событии."
              : "Черновик виден только вам. Детали можно дополнить позже."}
          </p>
          <nav className="event-form-steps" aria-label="Шаги создания события">
            <button
              type="button"
              aria-current={step === 0 ? "step" : undefined}
              onClick={() => showStep(0)}
            >
              <span>{step === 1 ? <Check size={15} /> : "1"}</span>О событии
            </button>
            <span className="event-step-line" aria-hidden="true" />
            <button
              type="button"
              aria-current={step === 1 ? "step" : undefined}
              onClick={() => {
                if (step === 0) next();
              }}
            >
              <span>2</span>Когда и где
            </button>
          </nav>
          <fieldset
            className="event-form-section"
            data-form-step="0"
            hidden={step !== 0}
          >
            <legend>Расскажите о событии</legend>
            <label>
              Название события
              <input
                name="title"
                required
                minLength={3}
                maxLength={160}
                placeholder="Например, вечер настольных игр"
                defaultValue={event?.title}
              />
            </label>
            <div className="form-row">
              <CategorySelect defaultValue={event?.topic} />
              <label>
                Тип события
                <select name="kind" defaultValue={event?.kind ?? "Встреча"}>
                  {EVENT_KINDS.map((kind) => (
                    <option key={kind}>{kind}</option>
                  ))}
                  {event?.kind && !EVENT_KINDS.includes(event.kind) && (
                    <option>{event.kind}</option>
                  )}
                </select>
              </label>
            </div>
            {communities.length > 0 ? (
              <>
                <label className="event-club-picker">
                  <span className="event-field-label">
                    Клуб по интересам<small>Необязательно</small>
                  </span>
                  <select
                    name="community_id"
                    defaultValue={
                      event?.community_id ?? initialCommunityId ?? ""
                    }
                  >
                    <option value="">Без клуба</option>
                    {communities.map((club) => (
                      <option key={club.id} value={club.id}>
                        {club.name}
                      </option>
                    ))}
                  </select>
                  <small>
                    {communities.length
                      ? "Событие появится на странице выбранного клуба."
                      : "Здесь появятся клубы, в которые вы вступили. Клуб можно добавить позже."}
                  </small>
                </label>
              </>
            ) : (
              <input
                type="hidden"
                name="community_id"
                value={event?.community_id ?? ""}
              />
            )}
            <label>
              <span className="event-field-label">
                Коротко о событии<small>Необязательно</small>
              </span>
              <textarea
                name="description"
                minLength={10}
                maxLength={5000}
                rows={3}
                defaultValue={event?.description}
                placeholder="Для кого встреча и что будет происходить? Достаточно пары предложений."
              />
              <span className="event-field-hint">
                Поможет участникам понять, интересно ли им ваше событие.
              </span>
            </label>
          </fieldset>
        </>
      )}
      <fieldset
        className="event-form-section"
        data-form-step="1"
        hidden={step !== 1}
      >
        <legend>
          {schedule
            ? "Дата, время и место"
            : move
              ? "Новые время и место"
              : "Запланируйте встречу"}
        </legend>
        <div className="form-row">
          <label>
            Начало · МСК
            <input
              name="starts_at"
              type="datetime-local"
              required
              value={startValue}
              onChange={(event) => changeStart(event.target.value)}
            />
          </label>
          <label>
            Окончание · МСК
            <input
              name="ends_at"
              type="datetime-local"
              required
              min={startValue}
              value={endValue}
              onChange={(event) => setEndValue(event.target.value)}
            />
          </label>
        </div>
        {!move && (
          <fieldset className="event-format-picker">
            <legend>Формат участия</legend>
            <div>
              {["Очно", "Онлайн", "Гибрид"].map((option) => (
                <label key={option}>
                  <input
                    type="radio"
                    name="format"
                    value={option}
                    checked={format === option}
                    onChange={() => setFormat(option)}
                  />
                  <span>{option}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}
        {online ? (
          <input type="hidden" name="city" value="Онлайн" />
        ) : (
          <CityPicker
            value={selectedCity}
            onChange={setSelectedCity}
            cities={CITIES}
          />
        )}
        {(online || format === "Гибрид") && (
          <div className="event-native-webinar">
            <Video size={22} />
            <div>
              <strong>Вебинар внутри ТФлоу</strong>
              <p>
                Камера, звук, показ экрана и чат — на странице этого события.
                Зрители войдут после регистрации.
              </p>
            </div>
          </div>
        )}
        {online ? (
          <>
            <input type="hidden" name="venue" value="Вебинар на ТФлоу" />
            <input type="hidden" name="address" value="" />
          </>
        ) : (
          <>
            <label>
              Площадка
              <input
                name="venue"
                required
                minLength={2}
                maxLength={160}
                value={physicalVenue}
                onChange={(event) => setPhysicalVenue(event.target.value)}
                placeholder="Название места, например библиотека или парк"
              />
            </label>
            <label>
              <span className="event-field-label">
                Адрес<small>Необязательно</small>
              </span>
              <input
                name="address"
                maxLength={240}
                value={physicalAddress}
                onChange={(event) => setPhysicalAddress(event.target.value)}
                placeholder="Улица и дом — можно добавить позже"
              />
            </label>
          </>
        )}
        {!move && (
          <label>
            <span className="event-field-label">
              Количество мест<small>Уже заполнено</small>
            </span>
            <input
              name="capacity"
              type="number"
              inputMode="numeric"
              required
              min={1}
              max={100000}
              defaultValue={event?.capacity ?? 100}
            />
          </label>
        )}
      </fieldset>
      {move && (
        <p className="event-field-hint">
          При изменении начала все активности сдвинутся на то же время.
          Программа должна помещаться между началом и окончанием события.
          Проверим пересечения и уведомим участников об изменениях.
        </p>
      )}
      <FormError error={error} />
      <div className="event-wizard-footer">
        {!move && step === 1 && (
          <button
            className="button secondary"
            type="button"
            disabled={busy}
            onClick={() => showStep(0)}
          >
            <ArrowLeft size={17} />
            Назад
          </button>
        )}
        {!move && step === 0 ? (
          <button className="button primary" type="button" onClick={next}>
            Далее: время и место
            <ArrowRight size={17} />
          </button>
        ) : (
          <Submit
            busy={busy}
            disabled={Boolean(scheduleUnchanged)}
            label={
              schedule
                ? "Сохранить расписание"
                : move
                  ? "Перенести событие"
                  : event
                    ? "Сохранить изменения"
                    : "Создать черновик"
            }
          />
        )}
      </div>
    </form>
  );
}
