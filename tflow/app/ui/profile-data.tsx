import { useEffect, useState, type FormEvent } from "react";
import { Check, ChevronDown } from "lucide-react";
import type {
  FlowEvent,
  ParticipantData,
  Profile,
  RequiredProfileField,
} from "../../lib/types";
import { ApiError } from "../../lib/api-error";
import {
  PROFILE_FIELDS,
  REQUIREMENT_FIELDS,
  profileValue,
  type ProfileFieldDefinition,
} from "../../lib/profile-fields";
import { FormError, Submit, type Send } from "./forms";
import { CityPicker } from "./city-picker";
import { InterestPicker } from "./interest-picker";

function DataField({
  field,
  value,
  onChange,
  errors = [],
  required = false,
  prefix,
}: {
  field: ProfileFieldDefinition;
  value: string;
  onChange: (value: string) => void;
  errors?: string[];
  required?: boolean;
  prefix: string;
}) {
  const id = `${prefix}-${field.key}`,
    errorId = `${id}-error`;
  const attrs = {
    id,
    name: field.key,
    value,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      onChange(e.target.value),
    required,
    placeholder: field.placeholder,
    autoComplete: field.autocomplete,
    "aria-invalid": errors.length > 0 ? true : undefined,
    "aria-describedby": errors.length ? errorId : undefined,
  };
  return (
    <div
      className={`form-field ${field.type === "textarea" ? "profile-field-wide" : ""}`}
    >
      <label htmlFor={id}>
        {field.label}
        {required && <span aria-hidden="true"> *</span>}
      </label>
      {field.type === "textarea" ? (
        <textarea {...attrs} rows={3} />
      ) : (
        <input
          {...attrs}
          type={field.type ?? "text"}
          max={
            field.type === "date"
              ? new Date().toLocaleDateString("en-CA")
              : undefined
          }
        />
      )}{" "}
      {errors.length > 0 && (
        <span className="profile-field-error" id={errorId}>
          {errors.join(" ")}
        </span>
      )}
    </div>
  );
}

export function ParticipantDetails({
  data,
  showEmpty = false,
}: {
  data: Partial<ParticipantData>;
  showEmpty?: boolean;
}) {
  return (
    <dl className="profile-data-grid">
      {PROFILE_FIELDS.filter(
        (field) => field.key !== "name" && (showEmpty || data[field.key]),
      ).map((field) => (
        <div
          key={field.key}
          className={field.type === "textarea" ? "profile-field-wide" : ""}
        >
          <dt>{field.label}</dt>
          <dd className={!data[field.key] ? "unfilled" : ""}>
            {data[field.key]
              ? profileValue(field.key, data[field.key]!)
              : "Не указано"}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function ExpandedProfileForm({
  profile,
  send,
  done,
}: {
  profile: Profile;
  send: Send;
  done: () => void;
}) {
  const [values, setValues] = useState<Profile>(profile),
    [error, setError] = useState(""),
    [fields, setFields] = useState<Record<string, string[]>>({}),
    [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    setFields({});
    try {
      const data = Object.fromEntries(
        PROFILE_FIELDS.filter((f) => f.key !== "name" && f.key !== "email").map(
          (f) => [f.key, values[f.key] ?? ""],
        ),
      );
      await send("profile", "PATCH", {
        ...data,
        first_name: values.first_name,
        last_name: values.last_name,
        interests: formData.getAll("interests").join(", "),
      });
      done();
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof ApiError) setFields(e.fields);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="flow-form expanded-profile-form"
      onSubmit={submit}
      aria-busy={busy}
    >
      <p className="muted small">
        Заполняйте в удобном темпе. При записи данные получит организатор, а
        повторно вводить их не придётся.
      </p>
      <fieldset className="profile-field-group">
        <legend>Контакты</legend>
        <div className="profile-form-grid">
          {(
            [
              ["first_name", "Имя", "given-name"],
              ["last_name", "Фамилия (необязательно)", "family-name"],
            ] as const
          ).map(([key, label, autocomplete]) => (
            <div className="form-field" key={key}>
              <label htmlFor={`profile-${key}`}>{label}</label>
              <input
                id={`profile-${key}`}
                name={key}
                required={key === "first_name"}
                autoComplete={autocomplete}
                value={values[key]}
                onChange={(e) =>
                  setValues({ ...values, [key]: e.target.value })
                }
                aria-invalid={fields[key]?.length ? true : undefined}
                aria-describedby={
                  fields[key]?.length ? `profile-${key}-error` : undefined
                }
              />
              {fields[key]?.length > 0 && (
                <span
                  className="profile-field-error"
                  id={`profile-${key}-error`}
                >
                  {fields[key].join(" ")}
                </span>
              )}
            </div>
          ))}
          {PROFILE_FIELDS.filter(
            (f) =>
              f.group === "Контакты" &&
              !["name", "email", "city"].includes(f.key),
          ).map((field) => (
            <DataField
              key={field.key}
              field={field}
              value={values[field.key] ?? ""}
              onChange={(value) => setValues({ ...values, [field.key]: value })}
              errors={fields[field.key]}
              prefix="profile"
            />
          ))}
          <CityPicker
            value={values.city}
            onChange={(city) => setValues({ ...values, city })}
            required={false}
            disabled={busy}
            error={fields.city?.join(" ")}
          />
        </div>
      </fieldset>
      <fieldset className="profile-field-group">
        <legend>Работа и учёба</legend>
        <div className="profile-form-grid">
          {PROFILE_FIELDS.filter((f) => f.group === "Работа и учёба").map(
            (field) => (
              <DataField
                key={field.key}
                field={field}
                value={values[field.key] ?? ""}
                onChange={(value) =>
                  setValues({ ...values, [field.key]: value })
                }
                errors={fields[field.key]}
                prefix="profile"
              />
            ),
          )}
        </div>
      </fieldset>
      <DataField
        field={PROFILE_FIELDS.find((f) => f.key === "about")!}
        value={values.about}
        onChange={(about) => setValues({ ...values, about })}
        errors={fields.about}
        prefix="profile"
      />
      <InterestPicker value={profile.interests} disabled={busy} />
      <p className="profile-email-note">Почта аккаунта: {profile.email}</p>
      <FormError error={error} />
      <div className="form-footer">
        <Submit busy={busy} label="Сохранить профиль" />
      </div>
    </form>
  );
}

export function CompleteRegistrationForm({
  profile,
  event,
  path,
  missing,
  send,
  done,
}: {
  profile: Profile;
  event: FlowEvent;
  path: string;
  missing: RequiredProfileField[];
  send: Send;
  done: () => void;
}) {
  const [keys, setKeys] = useState(missing),
    [values, setValues] = useState<Partial<ParticipantData>>({}),
    [error, setError] = useState(""),
    [fields, setFields] = useState<Record<string, string[]>>({}),
    [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setFields({});
    try {
      await send(
        path,
        "POST",
        Object.fromEntries(
          keys.map((key) => [key, values[key] ?? profile[key] ?? ""]),
        ),
      );
      done();
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof ApiError) {
        setFields(e.fields);
        if (e.code === "PROFILE_INCOMPLETE")
          setKeys((current) =>
            Array.from(new Set([...current, ...e.missing_fields])),
          );
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="flow-form complete-registration-form" onSubmit={submit}>
      <div className="registration-form-context">
        <strong>{event.title}</strong>
        <p>
          Организатору нужны ещё эти данные. Сохраним их в вашем профиле и сразу
          завершим запись.
        </p>
      </div>
      {keys.map((key) => {
        const field = REQUIREMENT_FIELDS.find((f) => f.key === key);
        return field ? (
          <DataField
            key={key}
            field={field}
            value={values[key] ?? profile[key] ?? ""}
            onChange={(value) => setValues({ ...values, [key]: value })}
            required
            errors={fields[key]}
            prefix="registration"
          />
        ) : null;
      })}
      <p className="muted small">
        Организатор получит данные вашего профиля вместе с регистрацией.
      </p>
      <FormError error={error} />
      <div className="form-footer">
        <Submit busy={busy} label="Сохранить и записаться" />
      </div>
    </form>
  );
}

export function RegistrationSettings({
  event,
  send,
  refresh,
  inDialog = false,
}: {
  event: FlowEvent;
  send: Send;
  refresh: () => Promise<void>;
  inDialog?: boolean;
}) {
  const savedKey = (event.required_profile_fields ?? []).join(",");
  const [selected, setSelected] = useState<RequiredProfileField[]>(
      event.required_profile_fields ?? [],
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  useEffect(() => {
    setSelected(
      savedKey ? (savedKey.split(",") as RequiredProfileField[]) : [],
    );
  }, [savedKey]);
  const dirty =
    [...selected].sort().join(",") !==
    [...(event.required_profile_fields ?? [])].sort().join(",");
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      await send(`events/${event.id}/requirements`, "PATCH", {
        required_profile_fields: selected,
      });
      await refresh();
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const form = (
    <form className="flow-form registration-settings-form" onSubmit={submit}>
      <p className="muted small">
        Имя и почта берутся из аккаунта. Отметьте, что ещё нужно для вашей
        встречи. Перед записью участник заполнит только недостающее.
      </p>
      <fieldset className="requirement-options">
        <legend className="sr-only">Обязательные поля профиля</legend>
        {REQUIREMENT_FIELDS.map((field) => (
          <label key={field.key}>
            <input
              type="checkbox"
              disabled={busy}
              checked={selected.includes(field.key as RequiredProfileField)}
              onChange={(e) => {
                setSaved(false);
                setSelected((current) =>
                  e.target.checked
                    ? [...current, field.key as RequiredProfileField]
                    : current.filter((key) => key !== field.key),
                );
              }}
            />
            <span>{field.label}</span>
          </label>
        ))}
      </fieldset>
      <p className="muted small">
        Новые требования применяются к новым записям. Уже зарегистрированных
        участников они не затронут.
      </p>
      <FormError error={error} />
      <div className="requirements-save">
        <Submit busy={busy} disabled={!dirty} label="Сохранить требования" />
        {saved && (
          <span role="status">
            <Check size={16} />
            Сохранено
          </span>
        )}
      </div>
    </form>
  );
  if (inDialog) return form;
  return (
    <details className="registration-settings">
      <summary>
        <div>
          <h2>Данные при записи</h2>
          <p>
            Имя и почта
            {event.required_profile_fields?.length
              ? ` + ${event.required_profile_fields.length} доп. полей`
              : " — без дополнительных требований"}
          </p>
        </div>
        <ChevronDown size={20} aria-hidden="true" />
      </summary>
      {form}
    </details>
  );
}
