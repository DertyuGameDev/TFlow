# ТФлоу в Spirit

Тенант: `hack-mmk-25`. Выделенная платформой VM: `vm1`, Ubuntu 24.04,
4 vCPU / 8 ГБ RAM / 50 ГБ диска. Квота команды — одна VM.
DNS: `hack-mmk-25-vm1-162f2c.vm.prodcontest.com`, IP: `158.160.209.13`.

CI в GitLab запускает TypeScript, frontend-тесты, сборку Vite и Django-тесты
с отдельной PostgreSQL 16. После успешных проверок job `package` сохраняет
`release/tflow-release.tar.gz` и `release/manifest.json` с SHA коммита и SHA-256 архива.
Этот архив содержит собранный frontend и Django, без локальных БД и секретов.
Выкладка выполняется отдельно командами ниже; push сам по себе не перезапускает VM.

## Первичная настройка

В интерфейсе Spirit откройте VM и скачайте SSH-ключ. Храните его вне репозитория
с правами `0600`. Пользователь SSH — `ubuntu`, у него доступен `sudo`.
Скопируйте этот каталог на выделенную VM и выполните:

```sh
sudo python3 bootstrap.py hack-mmk-25-vm1-162f2c.vm.prodcontest.com
```

Скрипт устанавливает PostgreSQL, Python и Caddy, создаёт отдельного пользователя
приложения и локальную PostgreSQL, генерирует runtime-секреты на VM и включает
HTTPS-прокси. Секреты лежат в `/etc/tflow/app.env` с правами `0600`.
Данные PostgreSQL и `/var/lib/tflow` сохраняются между релизами.

## Установка проверенного релиза

Скачайте артефакты успешного job `package` нужного pipeline из GitLab и загрузите
архив и manifest в `/srv/tflow/incoming` на VM. Затем:

```sh
sudo python3 install-release.py /srv/tflow/incoming/manifest.json /srv/tflow/incoming/tflow-release.tar.gz
sudo systemctl status tflow caddy postgresql
```

Установщик сверяет SHA-256, проверяет пути архива, собирает отдельное окружение
Python, сохраняет резервную копию PostgreSQL в `/var/backups/tflow`, применяет
миграции и статику, переключает `/srv/tflow/current` и проверяет `/api/health`.
При неудачном запуске возвращает предыдущий код; резервная копия БД сохраняется.
Автоматически откатывать схему БД он не пытается.

Приложение работает от `tflow` через Gunicorn на `127.0.0.1:8000`.
Caddy обслуживает публичный HTTPS и продлевает сертификат.
Логи: `sudo journalctl -u tflow -u caddy`.
Полный Git-репозиторий размещается отдельно в `/srv/tflow/repository`.

## Текущее состояние — 31 октября 2026

На VM установлен `199687f021adc9deef7bbc40c869ddd225ed6775` из
[успешного master pipeline 17486](https://gitlab.t-education.com/hack-mmk-25/tflow/-/pipelines/17486).
В CI прошли 234 Django-теста на PostgreSQL, 31 frontend-тест, 8 проверок
операций Spirit, TypeScript, сборка и упаковка.
Полный репозиторий той же версии находится в `/srv/tflow/repository`.

После отдельного согласия владельца выполнено штатное пересоздание vm1:
[job 51620](https://gitlab.t-education.com/hack-mmk-25/tflow/-/jobs/51620),
операция `edad2029-62ec-4e0e-a8c8-0cd6378bf8cc`.
ID VM, домен и IP сохранились. Spirit вернул `existPrevious: false`, несмотря
на запрос `withoutBackup: false`: предыдущего экземпляра нет.
Приложение, PostgreSQL и прежние runtime-секреты восстановлены из заранее
проверенной копии вне VM. Подробнее: [план и результат восстановления](./recovery-plan.md).
Новый SSH-ключ следует скачивать из Spirit: прежний клиентский ключ больше не подходит.

Миграции применены, `tflow`, `caddy`, `postgresql` активны и включены в автозапуск.
Внутренний `/api/health` возвращает 200. После восстановления в базе, как и до
него, 0 пользователей, 0 мероприятий и 0 регистраций. Данные Vercel не переносились.
Gunicorn и PostgreSQL слушают только loopback, Caddy — 80/443.
Caddy 2.11.7 установлен официальным пакетом с проверкой SHA-256.

**Публичный HTTPS не работает.** Пересоздание и повторное применение Default
не устранили таймауты проверки Let's Encrypt по HTTP-01 и TLS-ALPN-01.
Последняя операция применения правил
`2a258055-d3b7-4dc9-84a7-58eb0aa5f207` завершилась без ошибок.
[Независимая проверка после пересоздания](https://check-host.net/check-report/54a8343bkd52):
TCP 443 доступен из Москвы, соединение из Лос-Анджелеса завершается таймаутом.
Публичный HTTPS-запрос получает TLS `internal error`, поскольку доверенного
сертификата пока нет. Камера на публичном домене по этой причине не подтверждена.

Для выпуска сертификата нужна внешняя доступность 80/443 для центра
сертификации, даже если посетители находятся только в России. Требуется
исправление внешней фильтрации/маршрутизации или управление DNS для DNS-01.
Доступа к DNS-зоне домена у приложения нет. Обращение в поддержку не отправлялось
по указанию владельца. HTTP и отключение проверки TLS не используются как замена.
Автоматические попытки Caddy остаются включены.

Проверка публичного HTTPS без отключения TLS-проверки:

```sh
curl --fail --connect-timeout 5 --max-time 10 https://hack-mmk-25-vm1-162f2c.vm.prodcontest.com/api/health
sudo journalctl -u caddy -n 30 --no-pager
```

Локальная проверка приложения с VM:

```sh
curl --fail -H 'Host: hack-mmk-25-vm1-162f2c.vm.prodcontest.com' -H 'X-Forwarded-Proto: https' http://127.0.0.1:8000/api/health
```
