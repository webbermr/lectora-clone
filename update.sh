#!/bin/sh
# Get the latest SCORM Editor from GitHub and restart it. Saved projects are kept
# (they live in your browser, not in the container).
set -e
cd "$(dirname "$0")"

git pull --ff-only

# One-time clean-up: before it was renamed, the app ran as "lectora-clone" and
# would still be holding port 8080.
docker compose -p lectora-clone down --remove-orphans >/dev/null 2>&1 || true

docker compose up -d --build --remove-orphans
docker image prune -f >/dev/null

echo "SCORM Editor is up to date: http://localhost:8080"
