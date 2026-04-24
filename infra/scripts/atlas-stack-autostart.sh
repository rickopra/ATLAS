#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="/var/www/ATLAS"
COMPOSE_FILE="$ROOT_DIR/docker-compose.yml"
DOCKER_BIN="/usr/bin/docker"
LOCK_DIR="$ROOT_DIR/infra/logs/.atlas-stack-lock"
MODE="${1:-start}"
TARGET_CONTAINERS=(
  "atlas-postgres"
  "atlas-redis"
  "atlas-api"
  "atlas-web"
  "atlas-nginx"
)

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
      log "Docker daemon did not become ready in time."
      return 1
    fi
    sleep 5
  done
}

all_containers_healthy() {
  local container=""
  local inspect_output=""
  local status=""
  local health=""

  for container in "${TARGET_CONTAINERS[@]}"; do
    if ! inspect_output=$("$DOCKER_BIN" inspect -f '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}' "$container" 2>/dev/null); then
      return 1
    fi

    status="${inspect_output%% *}"
    health="${inspect_output#* }"

    if [ "$status" != "running" ]; then
      return 1
    fi

    if [ "$health" != "healthy" ] && [ "$health" != "no-healthcheck" ]; then
      return 1
    fi
  done

  return 0
}

start_stack() {
  log "Running docker compose up -d for ATLAS."
  (
    cd "$ROOT_DIR"
    "$DOCKER_BIN" compose -f "$COMPOSE_FILE" up -d
  )
}

wait_for_stack_health() {
  local attempt=0
  until all_containers_healthy; do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge 48 ]; then
      log "ATLAS stack did not reach healthy state in time."
      return 1
    fi
    sleep 5
  done
}

main() {
  wait_for_docker

  if [ "$MODE" = "--ensure" ] || [ "$MODE" = "ensure" ]; then
    if all_containers_healthy; then
      exit 0
    fi
    log "ATLAS stack is not fully healthy. Starting recovery."
  else
    log "Starting ATLAS stack after reboot."
  fi

  start_stack
  wait_for_stack_health
  log "ATLAS stack is healthy."
}

main "$@"
