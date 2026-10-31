import { useEffect, useState, type FormEvent } from "react";
import { ImagePlus, Trash2 } from "lucide-react";
import type { Profile } from "../../lib/types";
import { FormError, Submit, type Send } from "./forms";

export function Avatar({
  profile,
  className = "",
}: {
  profile: Pick<Profile, "name" | "avatar_url">;
  className?: string;
}) {
  return (
    <span className={`profile-avatar ${className}`}>
      {profile.avatar_url ? (
        <img src={profile.avatar_url} alt="" />
      ) : (
        profile.name.slice(0, 1)
      )}
    </span>
  );
}

export function AvatarForm({
  profile,
  send,
  done,
  endpoint = "profile/avatar",
  description = "Фото появится в вашем профиле и в шапке приложения. Изображение обрежется по центру.",
}: {
  profile: Pick<Profile, "name" | "avatar_url">;
  send: Send;
  done: () => void | Promise<void>;
  endpoint?: string;
  description?: string;
}) {
  const [file, setFile] = useState<File | null>(null),
    [preview, setPreview] = useState<string | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!file || busy) return;
    setError("");
    setBusy(true);
    try {
      const body = new FormData();
      body.append("avatar", file);
      await send(endpoint, "POST", body);
      await done();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setError("");
    setBusy(true);
    try {
      await send(endpoint, "DELETE");
      await done();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="flow-form avatar-form" onSubmit={save}>
      <Avatar
        profile={{
          name: profile.name,
          avatar_url: preview ?? profile.avatar_url,
        }}
        className="avatar-preview"
      />
      <p>{description}</p>
      <label className="avatar-upload">
        <span>
          <ImagePlus size={19} />
          Выбрать фото
        </span>
        <input
          aria-label="Выбрать фото"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={busy}
          onChange={(event) => {
            const next = event.target.files?.[0];
            setError("");
            if (!next) return;
            if (
              !["image/jpeg", "image/png", "image/webp"].includes(next.type)
            ) {
              setFile(null);
              setError("Выберите JPG, PNG или WebP");
              event.target.value = "";
              return;
            }
            if (next.size > 5 * 1024 * 1024) {
              setFile(null);
              setError("Размер фото — не больше 5 МБ");
              event.target.value = "";
              return;
            }
            setFile(next);
          }}
        />
      </label>
      <small>JPG, PNG или WebP · до 5 МБ и 16 мегапикселей</small>
      {file && <p className="avatar-filename">{file.name}</p>}
      <FormError error={error} />
      <div className="form-footer">
        {profile.avatar_url && (
          <button
            className="text-button avatar-remove"
            type="button"
            disabled={busy}
            onClick={() => void remove()}
          >
            <Trash2 size={16} />
            Удалить фото
          </button>
        )}
        {file && <Submit busy={busy} label="Сохранить фото" />}
      </div>
    </form>
  );
}
