@echo off
setlocal
title Second Brain - Installation und Start
cd /d "%~dp0"

echo ============================================
echo   Second Brain - Installation und Start
echo ============================================
echo.

rem --- Node.js suchen ---------------------------------------------------------
where node >nul 2>nul
if %errorlevel%==0 goto node_ok

if exist "%ProgramFiles%\nodejs\node.exe" (
  set "PATH=%ProgramFiles%\nodejs;%PATH%"
  goto node_ok
)

echo Node.js wurde nicht gefunden - automatische Installation ueber winget...
echo (Windows fragt ggf. einmal nach Bestaetigung)
echo.
winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements

if exist "%ProgramFiles%\nodejs\node.exe" (
  set "PATH=%ProgramFiles%\nodejs;%PATH%"
  goto node_ok
)
where node >nul 2>nul
if %errorlevel%==0 goto node_ok

echo.
echo Node.js konnte nicht automatisch installiert werden.
echo Bitte einmal von https://nodejs.org installieren (LTS, Standard-Optionen)
echo und dieses Skript danach erneut doppelklicken.
echo.
pause
exit /b 1

:node_ok
echo Gefundene Node-Version:
node --version
echo.

echo Vault wird indexiert...
node _system\indexer.js
echo.

echo Starte die Graph-Ansicht auf http://localhost:7777
echo (Dieses Fenster offen lassen - Beenden mit Strg+C oder Fenster schliessen)
echo.
start "" "http://localhost:7777"
node _system\server.js
pause
