$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$Backend = Join-Path $Root "backend"
$Frontend = Join-Path $Root "frontend"
$Python = Join-Path $Backend ".venv\Scripts\python.exe"
$LegacyPython = Join-Path $Backend ".venv313\Scripts\python.exe"

function Refresh-Path {
  $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = "$machinePath;$userPath"
}

Refresh-Path

if (-not (Test-Path $Python) -and (Test-Path $LegacyPython)) {
  $Python = $LegacyPython
}

function Test-NodeRuntime {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { return $false }
  if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { return $false }
  try {
    $major = [int]((& node --version).TrimStart("v").Split(".")[0])
    return $major -ge 20
  } catch {
    return $false
  }
}

function Test-BackendPackages {
  if (-not (Test-Path $Python)) { return $false }
  & $Python -c "import fastapi, uvicorn, websockets, kiteconnect" 2>$null
  return $LASTEXITCODE -eq 0
}

$NeedsSetup = $false
if (-not (Test-Path $Python)) { $NeedsSetup = $true }
if (-not (Test-BackendPackages)) { $NeedsSetup = $true }
if (-not (Test-NodeRuntime)) { $NeedsSetup = $true }
if (-not (Test-Path (Join-Path $Frontend "node_modules"))) { $NeedsSetup = $true }

if ($NeedsSetup) {
  Write-Host "Checking and installing missing dependencies..."
  & (Join-Path $PSScriptRoot "setup_windows.ps1")
  Refresh-Path
  $Python = Join-Path $Backend ".venv\Scripts\python.exe"
}

$BackendOut = Join-Path $Backend "backend.log"
$BackendErr = Join-Path $Backend "backend.err.log"
$FrontendOut = Join-Path $Frontend "frontend.log"
$FrontendErr = Join-Path $Frontend "frontend.err.log"

if (Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue) {
  Write-Host "Backend already running on http://127.0.0.1:8000"
} else {
  Write-Host "Starting backend on http://127.0.0.1:8000"
  Start-Process -FilePath $Python `
    -ArgumentList @("-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", "8000") `
    -WorkingDirectory $Backend `
    -RedirectStandardOutput $BackendOut `
    -RedirectStandardError $BackendErr `
    -WindowStyle Hidden
}

Start-Sleep -Seconds 2

if (Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue) {
  Write-Host "Frontend already running on http://127.0.0.1:5173"
} else {
  Write-Host "Starting frontend on http://127.0.0.1:5173"
  Refresh-Path
  Start-Process -FilePath "cmd.exe" `
    -ArgumentList @("/c", "npm run dev") `
    -WorkingDirectory $Frontend `
    -RedirectStandardOutput $FrontendOut `
    -RedirectStandardError $FrontendErr `
    -WindowStyle Hidden
}

Start-Sleep -Seconds 4
Start-Process "http://127.0.0.1:5173"
Write-Host "Dashboard launched. Logs are in backend and frontend folders."
