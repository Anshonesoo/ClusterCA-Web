@echo off
setlocal
cd /d "%~dp0"

set "NODE_EXE="
where node >nul 2>nul && set "NODE_EXE=node"
if defined NODE_EXE goto node_ok
set "RUNTIME_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if exist "%RUNTIME_NODE%" set "NODE_EXE=%RUNTIME_NODE%"
if defined NODE_EXE goto node_ok
echo [ERROR] Node.js not found. Install Node.js 20 or newer first.
pause
exit /b 1

:node_ok
if exist "dist\index.html" goto dist_ok
echo [ERROR] dist\index.html not found. Run pnpm build first.
pause
exit /b 1

:dist_ok
set "DISPLAY_PORT=%CLUSTERCA_PORT%"
if not defined DISPLAY_PORT set "DISPLAY_PORT=4173"
echo Starting the production build at http://127.0.0.1:%DISPLAY_PORT%/
echo Keep this window open. Press Ctrl+C to stop.
"%NODE_EXE%" "scripts\serve-dist.mjs"
