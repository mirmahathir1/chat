#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="${1:-}"
ENVIRONMENT="${2:-preview}"

if ! command -v vercel >/dev/null 2>&1; then
  echo "Vercel CLI is required. Install it with 'npm install -g vercel'."
  exit 1
fi

case "${TARGET}" in
  frontend)
    PROJECT_DIR="${ROOT_DIR}"
    OUTPUT_FILE="${ROOT_DIR}/.env.vercel.${ENVIRONMENT}.local"
    ;;
  backend)
    PROJECT_DIR="${ROOT_DIR}/backend"
    OUTPUT_FILE="${ROOT_DIR}/backend/.env.vercel.${ENVIRONMENT}.local"
    ;;
  *)
    echo "Usage: ./scripts/vercel-sync-env.sh <frontend|backend> [preview|development|production]"
    exit 1
    ;;
esac

cd "${PROJECT_DIR}"

exec vercel env pull "${OUTPUT_FILE}" --environment="${ENVIRONMENT}" --yes
