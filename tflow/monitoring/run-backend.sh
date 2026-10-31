#!/bin/sh
# Each master gets a fresh metrics directory, shared by its workers only.
set -eu
cd "$(dirname "$0")/.."
TFLOW_MONITORING_TOKEN=$(cat monitoring/secrets/metrics-token)
export TFLOW_MONITORING_TOKEN
export TFLOW_LOG_FILE="$PWD/backend/data/logs/tflow.jsonl"
PROMETHEUS_MULTIPROC_DIR=$(mktemp -d)
export PROMETHEUS_MULTIPROC_DIR
trap 'rm -rf "$PROMETHEUS_MULTIPROC_DIR"' EXIT
cd backend
../.venv/bin/gunicorn config.wsgi:application --config ../monitoring/gunicorn.conf.py --bind 127.0.0.1:8000 --workers "${WEB_CONCURRENCY:-2}" "$@" &
master=$!
trap 'kill -TERM "$master" 2>/dev/null || true' TERM INT
wait "$master" || { status=$?; wait "$master" 2>/dev/null || true; exit "$status"; }
