$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$Backend = Join-Path $Root "backend"
$Frontend = Join-Path $Root "frontend"
$VenvPython = Join-Path $Backend ".venv\Scripts\python.exe"
$NodeModules = Join-Path $Frontend "node_modules"

function Refresh-Path {
  $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $extraPaths = @(
    "$env:LOCALAPPDATA\Programs\Python\Python312",
    "$env:LOCALAPPDATA\Programs\Python\Python312\Scripts",
    "$env:LOCALAPPDATA\Programs\Python\Python313",
    "$env:LOCALAPPDATA\Programs\Python\Python313\Scripts",
    "$env:ProgramFiles\Python312",
    "$env:ProgramFiles\Python312\Scripts",
    "$env:ProgramFiles\Python313",
    "$env:ProgramFiles\Python313\Scripts",
    "$env:ProgramFiles\nodejs"
  )
  $wingetPackages = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages"
  if (Test-Path $wingetPackages) {
    $extraPaths += Get-ChildItem -LiteralPath $wingetPackages -Directory -Filter "OpenJS.NodeJS.LTS*" -ErrorAction SilentlyContinue |
      ForEach-Object { Join-Path $_.FullName "nodejs" }
  }
  $existingExtraPaths = $extraPaths | Where-Object { $_ -and (Test-Path $_) }
  $env:Path = (@($machinePath, $userPath) + $existingExtraPaths) -join ";"
}

function Add-UserPath {
  param([Parameter(Mandatory = $true)][string]$PathToAdd)
  if (-not (Test-Path $PathToAdd)) { return }
  $currentPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $parts = @($currentPath -split ";" | Where-Object { $_ })
  if ($parts -notcontains $PathToAdd) {
    $nextPath = (@($parts) + $PathToAdd) -join ";"
    [Environment]::SetEnvironmentVariable("Path", $nextPath, "User")
  }
}

function Require-Winget {
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    throw "winget was not found. Install 'App Installer' from Microsoft Store, reopen PowerShell, then rerun .\scripts\run_windows.ps1."
  }
}

function Test-Python312 {
  if (Get-Command py -ErrorAction SilentlyContinue) {
    try {
      $version = & py -3.12 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>$null
      if ([version]$version -ge [version]"3.12") { return $true }
    } catch {}
    try {
      $version = & py -3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>$null
      if ([version]$version -ge [version]"3.12") { return $true }
    } catch {}
  }
  if (Get-Command python -ErrorAction SilentlyContinue) {
    try {
      $version = & python -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>$null
      if ([version]$version -ge [version]"3.12") { return $true }
    } catch {}
  }
  foreach ($path in @(
    "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe",
    "$env:LOCALAPPDATA\Programs\Python\Python313\python.exe",
    "$env:ProgramFiles\Python312\python.exe",
    "$env:ProgramFiles\Python313\python.exe"
  )) {
    if (Test-Path $path) {
      try {
        $version = & $path -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>$null
        if ([version]$version -ge [version]"3.12") { return $true }
      } catch {}
    }
  }
  return $false
}

function New-BackendVenv {
  $venvDir = Join-Path $Backend ".venv"
  if (Test-Path $VenvPython) { return }
  Refresh-Path

  if (Get-Command python -ErrorAction SilentlyContinue) {
    try {
      $version = & python -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>$null
      if ([version]$version -ge [version]"3.12") {
        & python -m venv $venvDir
        if (Test-Path $VenvPython) { return }
      }
    } catch {}
  }

  if (Get-Command py -ErrorAction SilentlyContinue) {
    foreach ($selector in @("-3.12", "-3")) {
      try {
        & py $selector -m venv $venvDir 2>$null
        if (Test-Path $VenvPython) { return }
      } catch {}
    }
  }

  foreach ($pythonExe in @(
    "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe",
    "$env:LOCALAPPDATA\Programs\Python\Python313\python.exe",
    "$env:ProgramFiles\Python312\python.exe",
    "$env:ProgramFiles\Python313\python.exe"
  )) {
    if (-not (Test-Path $pythonExe)) { continue }
    try {
      $version = & $pythonExe -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>$null
      if ([version]$version -ge [version]"3.12") {
        & $pythonExe -m venv $venvDir
        if (Test-Path $VenvPython) { return }
      }
    } catch {}
  }

  throw "Could not create the Python virtual environment. Install Python 3.12+ from python.org or winget, then rerun Launch Dashboard.bat."
}

function Ensure-Python {
  Write-Host "Checking Python 3.12+..."
  Refresh-Path
  if (Test-Python312) { return }

  Write-Host "Python 3.12+ not found. Installing with winget..."
  Require-Winget
  winget install --id Python.Python.3.12 --exact --source winget --accept-package-agreements --accept-source-agreements
  Add-UserPath "$env:LOCALAPPDATA\Programs\Python\Python312"
  Add-UserPath "$env:LOCALAPPDATA\Programs\Python\Python312\Scripts"
  Add-UserPath "$env:ProgramFiles\Python312"
  Add-UserPath "$env:ProgramFiles\Python312\Scripts"
  Refresh-Path
  if (-not (Test-Python312)) {
    throw "Python installed, but is not visible on PATH yet. Close and reopen PowerShell, then rerun .\scripts\run_windows.ps1."
  }
}

function Test-Node20 {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { return $false }
  if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { return $false }
  try {
    $major = [int]((& node --version).TrimStart("v").Split(".")[0])
    return $major -ge 20
  } catch {
    return $false
  }
}

function Add-KnownNodePaths {
  Add-UserPath "$env:ProgramFiles\nodejs"
  $wingetPackages = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages"
  if (Test-Path $wingetPackages) {
    Get-ChildItem -LiteralPath $wingetPackages -Directory -Filter "OpenJS.NodeJS.LTS*" -ErrorAction SilentlyContinue |
      ForEach-Object { Add-UserPath (Join-Path $_.FullName "nodejs") }
  }
}

function Ensure-Node {
  Write-Host "Checking Node.js 20+ and npm..."
  Refresh-Path
  if (Test-Node20) { return }

  Write-Host "Node.js 20+ LTS or npm not found. Installing with winget..."
  Require-Winget
  winget install --id OpenJS.NodeJS.LTS --exact --source winget --accept-package-agreements --accept-source-agreements
  Add-KnownNodePaths
  Refresh-Path
  if (-not (Test-Node20)) {
    throw "Node.js installed, but node/npm is not visible on PATH yet. Close and reopen PowerShell, then rerun .\scripts\run_windows.ps1."
  }
}

if (-not (Test-Path $VenvPython)) {
  Ensure-Python
  Write-Host "Creating backend virtual environment..."
  New-BackendVenv
}

Write-Host "Checking backend packages..."
& $VenvPython -c "import fastapi, uvicorn, websockets, kiteconnect" 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-Host "Installing backend packages..."
  & $VenvPython -m pip install --upgrade pip
  & $VenvPython -m pip install -r (Join-Path $Backend "requirements.txt")
}

Ensure-Node

if (-not (Test-Path $NodeModules)) {
  Write-Host "Installing frontend packages..."
  Push-Location $Frontend
  npm install
  Pop-Location
} else {
  Write-Host "Frontend packages already installed."
}

Write-Host "Setup complete. Run Launch Dashboard.bat or scripts\run_windows.ps1 next."
