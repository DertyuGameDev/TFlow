# Технический мониторинг ТФлоу

Контур не добавляет пользовательских экранов и не меняет существующий внешний деплой.
Django → Prometheus (метрики) и JSON-файл → Alloy → Loki (логи).
Grafana объединяет метрики, ошибки со стеком и поиск по request_id.
Prometheus → Alertmanager → webhook команды; без внешнего адреса используется локальный журнал уведомлений.

## Локальный запуск (Linux, Docker Compose)

Из `tflow`:

```sh
.venv/bin/pip install -r backend/requirements.txt
python3 monitoring/setup.py
# Перезапустите уже работающий npm run dev, чтобы загрузить backend/.env.monitoring.
# Почта не требуется для мониторинга:
npm run dev
```

В другом терминале (приёмник алертов уже входит в Compose):

```sh
cd monitoring
docker compose up -d
```

Grafana: http://127.0.0.1:3001 — логин `tflow`, сгенерированный пароль в `monitoring/.env`.
Дашборд «ТФлоу · Эксплуатация» создаётся автоматически.
Prometheus: http://127.0.0.1:9090/targets; правила: `/rules`.
Alertmanager: http://127.0.0.1:9093; доставка: `monitoring/secrets/inbox/alerts.jsonl`.
Секреты не коммитятся. UIs и сборщики слушают только loopback.
Compose использует сеть Linux-хоста; для Docker Desktop нужны другие адреса backend и отдельная сеть.

Не запускайте второй Django на занятом порту. Проверка БД уже встроена в `/api/health`.
Секретный `/internal/metrics` отвечает только на GET с отдельным Bearer-токеном, не доступен по обычной пользовательской сессии.

## Для рабочего сервера

Настройте `TFLOW_MONITORING_TOKEN`, `TFLOW_LOG_FILE` и каталоги логов с правом записи для пользователя приложения.
Подключите тот же токен в Prometheus. Для HTTPS-сервера измените target/схему и адрес HTTP health probe; не отключайте проверку TLS.
Для нескольких Gunicorn workers используйте `sh monitoring/run-backend.sh`: он создаёт отдельный временный `PROMETHEUS_MULTIPROC_DIR`, общий для workers этого master, и регистрирует завершение worker.
Без этого обычные метрики одного процесса не агрегируют несколько workers! Для нескольких серверов нужен отдельный target каждого сервера.
Не используйте общий multiprocess-каталог между двумя master-процессами. Метрики — накопительные с момента запуска; история хранится в Prometheus.
Serverless-окружения требуют внешнего коллектора: этот файловый стек рассчитан на VM/контейнер.

Сборщики работают без Docker socket и без доступа к БД; Alloy читает только папку логов.
Prometheus хранит 15 дней, Loki — 7 дней; volumes сохраняются при перезапуске (`down -v` удаляет историю).
Установите адаптированный `monitoring/logrotate.conf` для ротации JSON-файла: WatchedFileHandler подхватывает новый файл без перезапуска.
Для резервных копий и удалённого доступа используйте существующую инфраструктуру команды, VPN/SSH-туннель; не публикуйте эти порты наружу.

Для доставки дежурным выполните:

```sh
python3 monitoring/setup.py --webhook-url https://YOUR-TEAM-RECEIVER/alerts
docker compose -f monitoring/compose.yaml restart alertmanager
```

Адрес должен принимать формат Alertmanager webhook (Telegram/Slack требуют адаптер, их API нельзя подставлять напрямую).
Без адреса команды алерты доставляются только в локальный inbox — это проверяемая демонстрация, а не уведомление дежурного на телефон.

## Проверка и диагностика

```sh
# Конфигурации и правила проверяются штатными бинарниками из тех же образов:
docker compose -f monitoring/compose.yaml config --quiet
docker compose -f monitoring/compose.yaml run --rm --entrypoint promtool prometheus check config /etc/prometheus/prometheus.yml
docker compose -f monitoring/compose.yaml run --rm --entrypoint promtool prometheus test rules /etc/prometheus/alerts-test.yml
```

Если метрик нет: смотрите Prometheus targets, совпадение токена, порт и HTTPS; если логов нет: TFLOW_LOG_FILE, права файла и Alloy.
В ответах Django есть `X-Request-ID`: вставьте его в поле Request ID дашборда; ERROR-панель содержит тип исключения и расположение кадров стека.
Не логируются тела запросов, query string, cookies, Authorization, данные пользователя и значения исключений/локальных переменных. Сообщения пишите константами, значения — только разрешёнными полями.
Метрики используют ограниченные наборы методов/маршрутов; UUID, email и ключи не создают новые серии.

Алерты: недоступность backend/БД через минуту, >5% 5xx (не менее пяти ошибок), p95 >2 с в течение пяти минут, повторяющиеся ERROR-логи.
Для проверки доставки остановите локальный Django на 90 секунд: TFlowUnavailable должен стать firing, попасть в inbox, после запуска — прийти resolved. На рабочем сайте такую проверку не выполняйте.
Отключение самого сервера мониторинга не может быть обнаружено этим же сервером: для этого требуется внешний uptime-monitor/дежурный контур.

Справка по реализации: [Prometheus multiprocess](https://prometheus.github.io/client_python/multiprocess/), [сбор логов Alloy → Loki](https://grafana.com/docs/alloy/latest/tutorials/send-logs-to-loki/).

При текущей локальной проверке сервисы запущены из официальных архивов без Docker, с временными данными в `/tmp/tflow-*`. После перезагрузки используйте Compose по инструкции выше; существующий внешний деплой автоматически не изменяется.

## Установка на существующем сервере и автозапуск

После обновления приложения и миграций, на VM с существующей службой `tflow` и Docker Compose:

```sh
python3 monitoring/install.py            # Только показать план
sudo python3 monitoring/install.py --apply
```

Установщик не создаёт VM и не меняет DNS/HTTPS. Добавляет systemd-службу сборщиков с автоматическим перезапуском, постоянные Docker volumes, логи `/var/log/tflow`, ротацию и минутный таймер напоминаний. Добавляет к существующему Gunicorn конфигурацию multiprocess-метрик, сохраняет копии изменяемых конфигураций. Пароль Grafana находится в `/opt/tflow-monitoring/.env`, технические порты остаются на loopback. Для доступа используйте SSH-туннель, например `ssh -L 3001:127.0.0.1:3001 ubuntu@YOUR-HOST`.

После установки проверьте `systemctl status tflow tflow-monitoring tflow-reminders.timer`, Prometheus targets, напоминание и доставку тестового алерта. При недоступности webhook Alertmanager повторяет доставку. Локальный приёмник включён в Compose и хранит сообщения в `secrets/inbox/alerts.jsonl`; он не получает доступ к остальным секретам.

Подключение к актуальному production пока не проверено: владелец сообщил, что текущий деплой устарел. Код установщика, конфигурации и локальный контур проверяются отдельно от внешней выкладки. После обновления деплоя потребуются адрес, доступ на VM и канал команды.
