#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="/var/www/ATLAS"
COMPOSE_FILE="$ROOT_DIR/docker-compose.yml"
DOCKER_BIN="/usr/bin/docker"
LOCK_DIR="$ROOT_DIR/infra/logs/.atlas-gws-employee-sync-lock"
API_CONTAINER="atlas-api"

export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

mkdir -p "$ROOT_DIR/infra/logs"

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  exit 0
fi
trap 'rmdir "$LOCK_DIR"' EXIT

log() {
  printf '[%s] %s\n' "$(date -u '+%Y-%m-%d %H:%M:%S UTC')" "$*"
}

wait_for_docker() {
  local attempt=0
  until "$DOCKER_BIN" info >/dev/null 2>&1; do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge 40 ]; then
      log "Docker daemon did not become ready in time for employee sync."
      return 1
    fi
    sleep 5
  done
}

api_container_healthy() {
  local inspect_output=""
  local status=""
  local health=""

  if ! inspect_output=$("$DOCKER_BIN" inspect -f '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}' "$API_CONTAINER" 2>/dev/null); then
    return 1
  fi

  status="${inspect_output%% *}"
  health="${inspect_output#* }"

  [ "$status" = "running" ] && [ "$health" = "healthy" -o "$health" = "no-healthcheck" ]
}

wait_for_api() {
  local attempt=0
  until api_container_healthy; do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge 36 ]; then
      log "ATLAS API container did not become healthy in time for employee sync."
      return 1
    fi
    sleep 5
  done
}

run_sync() {
  log "Starting Google Workspace employee sync."
  (
    cd "$ROOT_DIR"
    "$DOCKER_BIN" compose -f "$COMPOSE_FILE" exec -T api sh -lc 'cd /app && npm run sync:gws-directory'
  )
  log "Google Workspace employee sync finished."
}

main() {
  wait_for_docker
  wait_for_api
  run_sync
}

main "$@"
