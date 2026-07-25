# Varsity Kite UAT Dashboard

A compact React + FastAPI dashboard for Zerodha Kite Connect sandbox/UAT.

The folder is designed for sharing. It does not include `node_modules`, Python virtual environments, build output, or market-data caches.

## Included Tabs

- Sandbox login UI with local Kite UAT session persistence
- User info
- Instruments
- Snapshot data
- Historical data with OHLCV chart
- Realtime WebSocket ticks
- Stock screener with 52-week high/low and volume breakout checks
- SMA optimization backtest
- Orders
- Positions and P&L

## UAT Source of Truth

Codex should read `docs/UAT_SANDBOX_REFERENCE.md` before changing auth, market data, WebSocket, or order behavior.

This dashboard is built for:

- API root: `https://sandbox.kite.trade`
- Login URL: `https://sandbox.kite.trade/connect/login?api_key=sandboxdemo`
- WebSocket root: `wss://ws-sandbox.kite.trade`
- Demo API key: `sandboxdemo`
- Demo API secret: `sandboxdemo-secret`

Sandbox SDK routes are patched to use `/oms` except `/instruments`, matching the supplied UAT reference.

Only `LIMIT` orders are placed through the API. Do not use `MARKET` order placement in this sandbox.

## What Is Stored

After login, the backend stores only:

- API key
- Access token
- User ID for sandbox WebSocket authentication

It does not store API secret or request token.

The session file is local only: `backend/.kite_uat_session.json`

As long as that file remains in the local backend folder, browser refreshes and dashboard restarts reuse the saved
access token.

## Quick Start

Windows users can double-click:

```text
Launch Dashboard.bat
```

That launcher detects what is missing, installs Python 3.12+ and Node.js 20+ through winget when needed, adds known install folders to PATH, installs app dependencies, starts both services, and opens the dashboard.

For Codex or ChatGPT users opening this folder:

1. Read `requirements.txt`.
2. Run the one launch command for your OS.
3. Read `CODEX_START_HERE.md` only if more context is needed.

Windows PowerShell:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\run_windows.ps1
```

macOS/Linux:

```bash
chmod +x scripts/setup_mac.sh scripts/run_mac.sh
./scripts/run_mac.sh
```

The run scripts attempt to install missing system/app dependencies, reuse already-running servers, launch both services, and open
`http://127.0.0.1:5173`.

If setup stops because the OS needs a terminal restart or permission step, follow the last printed instruction and rerun the same command.

## Manual Run

Backend:

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 127.0.0.1 --port 8000
```

On Windows, activate with:

```powershell
backend\.venv\Scripts\Activate.ps1
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

Open:

```text
http://127.0.0.1:5173
```

## Share Size

Zip and share the source folder before running setup. Do not include:

- `frontend/node_modules`
- `frontend/dist`
- `backend/.venv`
- `backend/.cache`
- `backend/.kite_session.json`
- `backend/.kite_uat_session.json`
