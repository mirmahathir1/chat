#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ ! -d "${ROOT_DIR}/node_modules" ]]; then
  echo "backend/node_modules is missing. Run 'cd backend && npm install' first."
  exit 1
fi

NODEMON_BIN="${ROOT_DIR}/node_modules/.bin/nodemon"

if [[ ! -x "${NODEMON_BIN}" ]]; then
  echo "backend nodemon dependency is missing. Run 'cd backend && npm install' first."
  exit 1
fi

cd "${ROOT_DIR}"

exec "${NODEMON_BIN}" \
  --watch src \
  --ext ts,json \
  --signal SIGTERM \
  --exec "node --import tsx src/server.ts"
