#!/bin/bash
# Double-click from Finder to open Voyage (starts dev server if needed).

APP_DIR="/Users/ava/travel-planner"
PORT=3000
URL="http://localhost:${PORT}/trips"

cd "$APP_DIR" || exit 1

if ! curl -s -o /dev/null --connect-timeout 1 "http://localhost:${PORT}/" 2>/dev/null; then
  osascript -e "tell application \"Terminal\" to do script \"cd '$APP_DIR' && npm run dev\""
  echo "Starting Voyage dev server..."
  for _ in $(seq 1 45); do
    if curl -s -o /dev/null --connect-timeout 1 "http://localhost:${PORT}/" 2>/dev/null; then
      break
    fi
    sleep 1
  done
fi

open "$URL"
