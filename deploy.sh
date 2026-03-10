#!/usr/bin/env bash

set -euo pipefail

git rev-parse --is-inside-work-tree >/dev/null 2>&1

remote="${GIT_REMOTE:-origin}"
branch="$(git rev-parse --abbrev-ref HEAD)"
timestamp="$(date '+%Y-%m-%d %H:%M:%S %Z')"
prefix="${*:-chore}"
message="${prefix}: ${timestamp}"

if [[ -z "$(git status --porcelain)" ]]; then
  echo "No changes to commit."
  exit 0
fi

echo "Running build checks..."
npm run build

git add -A
git commit -m "$message"
git push "$remote" "$branch"

echo "Pushed ${branch} to ${remote} with commit message: ${message}"
