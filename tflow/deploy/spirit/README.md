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

## Проверка развёртывания

На 31 октября 2026 установлен релиз `513c781236a93680d06609a3470e73a085fde8e3`
из [успешного pipeline 17328](https://gitlab.t-education.com/hack-mmk-25/tflow/-/pipelines/17328).
В CI прошли 197 Django-тестов на PostgreSQL и 23 frontend-теста, TypeScript,
сборка и упаковка. На VM применены миграции, службы `tflow`, `caddy`, `postgresql`
включены в автозапуск. Здесь отдельная новая база; данные Vercel не переносились.

Через SSH-туннель проверены настоящие регистрация и вход, сохранение профиля,
PNG QR, отказ в выдаче QR без авторизации (401), отсутствие горизонтального
переполнения профиля на ширине 390 px. Профиль и сессия сохранились после
`systemctl restart tflow`. Временный проверочный аккаунт и его сессии удалены.

**Публичный HTTPS пока не подтверждён.** ACME-проверки Let's Encrypt по HTTP-01
и TLS-ALPN-01 завершаются `Timeout during connect` к `158.160.209.13`.
Входящие соединения снаружи нестабильны: часть HTTP-запросов получает 308,
часть зависает. Гостевой firewall не блокирует трафик, Caddy слушает 80/443.
Шаблон Spirit `Default` (TCP 22, 80, 443, 8000–8100 и исходящий трафик)
повторно применён, операция выполнена. Дополнительные публичные порты не открывались.
Нужна проверка внешней маршрутизации/фильтрации на стороне инфраструктуры.
Автоматические попытки выпуска сертификата Caddy остаются включены.

Проверка после восстановления сети (без отключения проверки TLS):

```sh
curl --fail --connect-timeout 5 --max-time 10 https://hack-mmk-25-vm1-162f2c.vm.prodcontest.com/api/health
sudo journalctl -u caddy -n 30 --no-pager
```

Локальная проверка приложения с VM, независимо от выпуска сертификата:

```sh
curl --fail -H 'Host: hack-mmk-25-vm1-162f2c.vm.prodcontest.com' -H 'X-Forwarded-Proto: https' http://127.0.0.1:8000/api/health
```
