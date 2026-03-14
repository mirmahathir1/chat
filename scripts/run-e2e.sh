#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env.local"

if [[ -f "${ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
fi

cd "${ROOT_DIR}"

exec concurrently \
  -k \
  -s first \
  -n frontend,backend,peer,cypress \
  "VITE_PEER_HOST=127.0.0.1 VITE_PEER_PORT=9000 VITE_PEER_PATH=/ VITE_PEER_SECURE=false VITE_RELAY_BACKEND_URL=http://localhost:8788 npm run dev -- --host localhost --port 4173 --strictPort" \
  "RELAY_ALLOWED_ORIGINS=http://localhost:4173 RELAY_PORT=8788 npm --prefix backend run dev" \
  "./node_modules/.bin/peerjs --host 127.0.0.1 --port 9000 --path /" \
  "wait-on http://localhost:4173 http-get://localhost:8788/api/health tcp:9000 && env -u ELECTRON_RUN_AS_NODE cypress run --config-file cypress.config.js"
