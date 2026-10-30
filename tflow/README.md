# ТФлоу 0.3: Django + React

## Разработка

```bash
npm ci
npm run setup
npm run dev
```

`setup` создаёт `.venv`, устанавливает зафиксированные Python-зависимости, применяет миграции и переносит старую локальную D1, если она найдена. `dev` запускает Django на 8000 и Vite на 5173. Node используется для разработки/сборки frontend; все API, доступ и бизнес-операции выполняются в Django.

Данные: `backend/data/tflow.sqlite3`. Резервные копии: `backend/data/backups/`. Это игнорируемые файлы. Импортированные аккаунты получают непригодный для входа пароль; прежний локальный демо-пользователь доступен через кнопку на странице входа в DEBUG. Для реальных аккаунтов используйте регистрацию или управление паролями Django.

Ручной импорт внешнего экспортированного SQLite:

```bash
.venv/bin/python backend/manage.py import_d1 /absolute/path/to/old.sqlite
```

Скрипт работает со снимком, не изменяет исходный файл, не перезаписывает существующие строки и проверяет согласованность расписания перед фиксацией транзакции. Экспорт live D1 не выполняется автоматически.

## Проверки

```bash
npm run check
npm run build
npm run test:backend
```

## Production

Django обслуживает также `dist/index.html`, собранные JS/CSS и страницы входа/регистрации. Node в runtime не нужен. Переменные окружения перечислены в `backend/.env.example`; они передаются окружением процесса/хостинга, файл сам по себе не подгружается.

```bash
npm run build
.venv/bin/python backend/manage.py collectstatic --noinput
# Установить DJANGO_DEBUG=0, DJANGO_SECRET_KEY, DJANGO_ALLOWED_HOSTS и HTTPS proxy settings.
# В корне tflow:
.venv/bin/python backend/entrypoint.py
```

`entrypoint.py` применяет миграции и запускает Gunicorn на порту `PORT` (по умолчанию 8000). Внешний reverse proxy должен предоставлять HTTPS. `DJANGO_TRUST_PROXY=1` допустим только если доверенный proxy перезаписывает `X-Forwarded-Proto`.

SQLite сохраняется в `backend/data`; для нескольких реплик сервера используйте общий PostgreSQL через `DATABASE_URL`. Для SQLite нельзя запускать независимые реплики с отдельными файлами данных и ожидать единого расписания.

### Docker

```bash
docker build -t tflow .
# Передать свои переменные через environment/secret manager:
docker run --env-file /path/to/runtime.env -p 8000:8000 -v tflow-data:/app/backend/data tflow
```

Контейнер не содержит локальную базу, учётные записи, `.env` и секреты. Он работает без root. Dockerfile подготовлен; фактическая сборка Docker не запускалась в текущей среде.

ChatGPT Sites/Cloudflare Worker больше не является runtime этого приложения. Его несекретный манифест сохранён только как `docs/legacy-sites-hosting.json` для исторической публикации. Для развёртывания Django нужен Python/Docker-хостинг.
