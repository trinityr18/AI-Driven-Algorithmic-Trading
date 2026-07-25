#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"

node_ok() {
  command -v node >/dev/null 2>&1 || return 1
  command -v npm >/dev/null 2>&1 || return 1
  [ "$(node --version | sed 's/^v//' | cut -d. -f1)" -ge 20 ]
}

needs_setup=0
[ -x "$BACKEND/.venv/bin/python" ] || needs_setup=1
if [ -x "$BACKEND/.venv/bin/python" ]; then
  "$BACKEND/.venv/bin/python" -c 'import fastapi, uvicorn, websockets, kiteconnect' >/dev/null 2>&1 || needs_setup=1
fi
node_ok || needs_setup=1
[ -d "$FRONTEND/node_modules" ] || needs_setup=1

if [ "$needs_setup" -eq 1 ]; then
  echo "Checking and installing missing dependencies..."
  "$ROOT/scripts/setup_mac.sh"
fi

if lsof -iTCP:8000 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Backend already running on http://127.0.0.1:8000"
else
  echo "Starting backend on http://127.0.0.1:8000"
  cd "$BACKEND"
  "$BACKEND/.venv/bin/python" -m uvicorn main:app --host 127.0.0.1 --port 8000 > "$BACKEND/backend.log" 2> "$BACKEND/backend.err.log" &
  echo $! > "$BACKEND/backend.pid"
fi

sleep 2

if lsof -iTCP:5173 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Frontend already running on http://127.0.0.1:5173"
else
  echo "Starting frontend on http://127.0.0.1:5173"
  cd "$FRONTEND"
  npm run dev > "$FRONTEND/frontend.log" 2> "$FRONTEND/frontend.err.log" &
  echo $! > "$FRONTEND/frontend.pid"
fi

sleep 4
if command -v open >/dev/null 2>&1; then
  open "http://127.0.0.1:5173"
else
  echo "Open http://127.0.0.1:5173 in a browser."
fi
echo "Dashboard launched. Logs are in backend and frontend folders."
