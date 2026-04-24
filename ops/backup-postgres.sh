#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

source .env

STAMP="$(date +%Y%m%d-%H%M%S)"
OUT_DIR="${ROOT_DIR}/backups"
mkdir -p "$OUT_DIR"

OUT_FILE="${OUT_DIR}/atlas-${STAMP}.sql.gz"
docker compose exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" | gzip -9 > "$OUT_FILE"

find "$OUT_DIR" -type f -name 'atlas-*.sql.gz' | sort | head -n -14 | xargs -r rm -f

echo "Backup saved to ${OUT_FILE}"
