#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

WORKBOOK_NAME="${1:-}"
if [[ -z "$WORKBOOK_NAME" ]]; then
  echo "Usage: ./ops/import-workbook.sh \"IT Ops Procurement Portal (Production) (7).xlsx\""
  exit 1
fi

mkdir -p "${ROOT_DIR}/imports"

if [[ ! -f "${ROOT_DIR}/imports/${WORKBOOK_NAME}" ]]; then
  echo "Workbook not found in ${ROOT_DIR}/imports/${WORKBOOK_NAME}"
  exit 1
fi

docker compose run --rm \
  -v "${ROOT_DIR}/imports:/imports:ro" \
  api \
  node apps/api/dist/scripts/import-workbook.js "/imports/${WORKBOOK_NAME}"
