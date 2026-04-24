#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f .env ]]; then
  echo ".env is missing. Copy .env.example first."
  exit 1
fi

echo "Building and starting ATLAS services..."
docker compose pull --ignore-pull-failures
docker compose build --pull
docker compose up -d postgres redis

echo "Applying database schema..."
docker compose run --rm api npm run db:deploy

echo "Starting application services..."
docker compose up -d --remove-orphans

echo "Waiting for API health..."
for _ in {1..45}; do
  if docker compose exec -T api wget -qO- http://127.0.0.1:4000/health >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

echo "Current service status:"
docker compose ps

echo "ATLAS on-prem stack deployed successfully."
