#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="${ROOT_DIR}/backend"

if ! command -v vercel >/dev/null 2>&1; then
  echo "Vercel CLI is required. Install it with 'npm install -g vercel'."
  exit 1
fi

cd "${BACKEND_DIR}"

npm run typecheck
npm run build
exec vercel deploy --prod "$@"
