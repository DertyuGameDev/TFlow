import { ArrowRight, CalendarDays, ScanLine, Users } from "lucide-react";

export function OrganizerIntro() {
  return <section className="organizer-intro" aria-labelledby="organizer-intro-title">
    <span className="organizer-eyebrow"><CalendarDays size={18} /> Ваше следующее событие</span>
    <h1 id="organizer-intro-title">Собирайте людей<br />вокруг своих идей</h1>
    <p className="organizer-lead">Создайте аккаунт организатора, подготовьте событие и пригласите участников в ТФлоу. Роль выбирается при регистрации и не меняется.</p>
    <ol className="organizer-steps">
      <li><CalendarDays size={24} /><h2>Расскажите о событии</h2><p>Название, время, место и количество участников. Программу можно добавить позже.</p></li>
      <li><Users size={24} /><h2>Откройте регистрацию</h2><p>Опубликуйте готовый черновик. Событие появится в каталоге, и участники смогут записаться.</p></li>
      <li><ScanLine size={24} /><h2>Встречайте гостей</h2><p>Сканируйте QR на входе или ведите онлайн-вебинар в своём кабинете.</p></li>
    </ol>
    <div className="organizer-enable">
      <p>Организатор создаёт события и управляет ими. Для записи на события нужен аккаунт участника.</p>
      <a className="button primary" href="/register/?role=organizer&next=%2F%23organizer">Зарегистрироваться как организатор<ArrowRight size={18} /></a>
      <a className="text-button" href="/login/?next=%2F%23organizer">Уже есть аккаунт? Войти</a>
    </div>
  </section>;
}
