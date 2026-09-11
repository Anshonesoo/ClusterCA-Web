@echo off
setlocal
cd /d "%~dp0"

rem --- Locate Node.js ---
set "NODE="
where node >nul 2>nul && set "NODE=node"
if defined NODE goto node_ok
set "FALLBACK=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if exist "%FALLBACK%" set "NODE=%FALLBACK%"
if defined NODE goto node_ok
echo [ERROR] Node.js not found in PATH or at the known runtime location.
echo         Install Node.js, or edit the FALLBACK path in this script.
pause
exit /b 1
:node_ok

rem --- Check dependencies ---
if exist "node_modules\vite\bin\vite.js" goto deps_ok
echo [ERROR] Dependencies not installed yet.
echo         Run one of the following first:
echo           npm install
echo           pnpm install
pause
exit /b 1
:deps_ok

echo Starting ClusterCA Web V2...
echo Dev server: http://localhost:5173
start "ClusterCA Web V2 - Vite" /min cmd /c ""%NODE%" "node_modules\vite\bin\vite.js""
timeout /t 1 /nobreak >nul
start "" "http://localhost:5173"
exit /b 0
