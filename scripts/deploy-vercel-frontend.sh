#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v vercel >/dev/null 2>&1; then
  echo "Vercel CLI is required. Install it with 'npm install -g vercel'."
  exit 1
fi

cd "${ROOT_DIR}"

npm run test:run
npm run build
exec vercel deploy --prod "$@"
