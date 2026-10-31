import { useRef, useState, type FormEvent } from "react";
import { ArrowRight, CalendarDays, Check, ScanLine, Users } from "lucide-react";
import type { UserIdentity } from "../../lib/types";
import { FormError, type Send } from "./forms";

type Props = {
  user: UserIdentity | null;
  send: Send;
  onEnabled: (user: UserIdentity) => void;
};

export function OrganizerIntro({ user, send, onEnabled }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);

  async function enable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await send("profile/become-organizer", "POST", {}) as { user: UserIdentity };
      onEnabled(result.user);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось открыть кабинет. Попробуйте ещё раз.");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return <section className="organizer-intro" aria-labelledby="organizer-intro-title">
    <span className="organizer-eyebrow"><CalendarDays size={18} /> Ваше следующее событие</span>
    <h1 id="organizer-intro-title">Собирайте людей<br />вокруг своих идей</h1>
    <p className="organizer-lead">От небольшой встречи до большой конференции — создайте событие и пригласите участников в ТФлоу.</p>
    <ol className="organizer-steps">
      <li><CalendarDays size={24} /><h2>Расскажите о событии</h2><p>Название, время, место и количество участников. Программу можно добавить позже.</p></li>
      <li><Users size={24} /><h2>Откройте регистрацию</h2><p>Опубликуйте готовый черновик. Событие появится в каталоге, и участники смогут записаться.</p></li>
      <li><ScanLine size={24} /><h2>Встречайте гостей</h2><p>Сканируйте QR на входе и следите за регистрациями в своём кабинете.</p></li>
    </ol>
    {user ? <form className="organizer-enable" onSubmit={enable} aria-busy={busy}>
      <p><Check size={18} /> Ваши записи на события, расписание и личный QR сохранятся. Вы сможете и участвовать, и организовывать.</p>
      <FormError error={error} />
      <button className="button primary" type="submit" disabled={busy}>{busy ? "Открываем кабинет…" : "Стать организатором"}<ArrowRight size={18} /></button>
    </form> : <div className="organizer-enable">
      <a className="button primary" href="/register/?role=organizer&next=%2F%23organizer">Зарегистрироваться как организатор<ArrowRight size={18} /></a>
      <a className="text-button" href="/login/?next=%2F%23organizer">Уже есть аккаунт? Войти</a>
    </div>}
  </section>;
}
