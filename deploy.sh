#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="${ROOT_DIR}/backend"
BACKEND_VERCEL_LINK="${BACKEND_DIR}/.vercel/project.json"

git -C "${ROOT_DIR}" rev-parse --is-inside-work-tree >/dev/null 2>&1

ensure_vercel_link() {
  local target="$1"
  local project_file="$2"
  local link_script="$3"

  if [[ -f "${project_file}" ]]; then
    return
  fi

  echo "Missing Vercel link for ${target}. Linking now..."
  "${ROOT_DIR}/${link_script}"

  if [[ ! -f "${project_file}" ]]; then
    echo "Unable to link ${target} Vercel project: ${project_file}"
    exit 1
  fi
}

ensure_vercel_link "backend" "${BACKEND_VERCEL_LINK}" "scripts/vercel-link-backend.sh"

remote="${GIT_REMOTE:-origin}"
branch="$(git -C "${ROOT_DIR}" rev-parse --abbrev-ref HEAD)"
timestamp="$(date '+%Y-%m-%d %H:%M:%S %Z')"
prefix="${*:-chore}"
message="${prefix}: ${timestamp}"

if [[ -z "$(git -C "${ROOT_DIR}" status --porcelain)" ]]; then
  echo "No changes to commit. Continuing with deployment."
else
  echo "Committing and pushing current changes..."
  git -C "${ROOT_DIR}" add -A
  git -C "${ROOT_DIR}" commit -m "$message"
  git -C "${ROOT_DIR}" push "$remote" "$branch"

  echo "Pushed ${branch} to ${remote} with commit message: ${message}"
fi

echo "Deploying backend..."
"${ROOT_DIR}/scripts/deploy-vercel-backend.sh"

echo "Frontend deploy is handled by GitHub Pages on push."

echo "Backend deployment completed."
