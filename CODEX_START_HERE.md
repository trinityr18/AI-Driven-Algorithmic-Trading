# Codex Start Here

Goal: launch the Varsity Kite UAT Dashboard with minimal reading.

For launch-only tasks, read only:

1. `requirements.txt`
2. This file
3. Logs only if launch fails

Do not scan source, `docs`, `frontend/node_modules`, `frontend/dist`, `backend/.venv`, `backend/.cache`, logs, or token files.

Read `docs/UAT_SANDBOX_REFERENCE.md` only before changing auth, market data, WebSocket, or order behavior.

## One Command

Windows users can double-click:

```text
Launch Dashboard.bat
```

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

The run script attempts to install missing system and app dependencies, starts backend/frontend, and opens:

```text
http://127.0.0.1:5173
```

## If Setup Stops

Follow the last printed instruction, reopen the terminal if asked, and rerun the same launch command.

## UAT Constants

- API root: `https://sandbox.kite.trade`
- Login URL: `https://sandbox.kite.trade/connect/login?api_key=sandboxdemo`
- API key: `sandboxdemo`
- API secret: `sandboxdemo-secret`
- WebSocket root: `wss://ws-sandbox.kite.trade`
- Orders: use `LIMIT` only

Saved access tokens are local in `backend/.kite_uat_session.json` and are excluded from sharing.
