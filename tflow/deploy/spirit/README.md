# ТФлоу в Spirit

Тенант: `hack-mmk-25`. Выделенная платфомой VM: `vm1`, Ubuntu 24.04,
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
