#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"

refresh_path() {
  if [ -x /opt/homebrew/bin/brew ]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [ -x /usr/local/bin/brew ]; then
    eval "$(/usr/local/bin/brew shellenv)"
  fi
}

ensure_brew() {
  refresh_path
  if command -v brew >/dev/null 2>&1; then
    return
  fi
  echo "Homebrew not found. Installing Homebrew..."
  NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  refresh_path
  if ! command -v brew >/dev/null 2>&1; then
    echo "Homebrew installed but is not on PATH yet. Reopen Terminal and rerun ./scripts/run_mac.sh"
    exit 1
  fi
}

python_ok() {
  command -v python3.12 >/dev/null 2>&1 && python3.12 -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 12) else 1)'
}

ensure_python() {
  refresh_path
  if python_ok; then
    return
  fi
  ensure_brew
  echo "Installing Python 3.12+..."
  brew install python@3.12
  refresh_path
  if ! python_ok; then
    echo "Python 3.12 installed but is not on PATH yet. Reopen Terminal and rerun ./scripts/run_mac.sh"
    exit 1
  fi
}

node_ok() {
  command -v node >/dev/null 2>&1 || return 1
  command -v npm >/dev/null 2>&1 || return 1
  [ "$(node --version | sed 's/^v//' | cut -d. -f1)" -ge 20 ]
}

ensure_node() {
  refresh_path
  if node_ok; then
    return
  fi
  ensure_brew
  echo "Installing Node.js 20+..."
  brew install node
  refresh_path
  if ! node_ok; then
    echo "Node.js installed but is not on PATH yet. Reopen Terminal and rerun ./scripts/run_mac.sh"
    exit 1
  fi
}

if [ ! -x "$BACKEND/.venv/bin/python" ]; then
  ensure_python

  echo "Creating backend virtual environment..."
  python3.12 -m venv "$BACKEND/.venv"
fi

echo "Checking backend packages..."
if ! "$BACKEND/.venv/bin/python" -c 'import fastapi, uvicorn, websockets, kiteconnect' >/dev/null 2>&1; then
  echo "Installing backend packages..."
  "$BACKEND/.venv/bin/python" -m pip install --upgrade pip
  "$BACKEND/.venv/bin/python" -m pip install -r "$BACKEND/requirements.txt"
fi

ensure_node

if [ ! -d "$FRONTEND/node_modules" ]; then
  echo "Installing frontend packages..."
  cd "$FRONTEND"
  npm install
else
  echo "Frontend packages already installed."
fi

echo "Setup complete. Run ./scripts/run_mac.sh next."
