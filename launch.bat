@echo off
setlocal EnableExtensions

cd /d "%~dp0"
set "NPM_CONFIG_CACHE=%CD%\.npm-cache"
if not exist "%NPM_CONFIG_CACHE%" mkdir "%NPM_CONFIG_CACHE%"

echo [1/3] Checking Node.js prerequisites...
where node >nul 2>nul
if errorlevel 1 goto install_node
goto check_npm

:install_node
echo Node.js not found. Attempting install via winget...
where winget >nul 2>nul
if errorlevel 1 (
  echo ERROR: winget is not available. Install Node.js LTS from https://nodejs.org/ then rerun this script.
  exit /b 1
)
winget install --id OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
if errorlevel 1 (
  echo ERROR: Failed to install Node.js with winget.
  exit /b 1
)
set "PATH=%ProgramFiles%\nodejs;%PATH%"
set "PATH=%ProgramFiles(x86)%\nodejs;%PATH%"

:check_npm
where npm >nul 2>nul
if errorlevel 1 (
  echo ERROR: npm is not available in this terminal session.
  echo Close this terminal, open a new one, then run launch.bat again.
  exit /b 1
)

echo [2/3] Installing project dependencies...
if exist package-lock.json (
  call npm ci
  if errorlevel 1 (
    echo npm ci failed. Retrying with npm install...
    call npm install
  )
) else (
  call npm install
)
if errorlevel 1 (
  echo ERROR: Dependency install failed.
  exit /b 1
)

echo [3/3] Launching development server...
call npm run dev
exit /b %errorlevel%
