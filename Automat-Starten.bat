@echo off
setlocal
title Second Brain - Automat (Regeln nach Zeitplan)
cd /d "%~dp0"

where node >nul 2>nul
if %errorlevel%==0 goto node_ok
if exist "%ProgramFiles%\nodejs\node.exe" (
  set "PATH=%ProgramFiles%\nodejs;%PATH%"
  goto node_ok
)
echo Node.js fehlt - bitte zuerst "Installieren-und-Starten.bat" ausfuehren.
pause
exit /b 1

:node_ok
echo Der Automat laeuft - Regeln siehe _system\regeln.json
echo (Fenster offen lassen - Beenden mit Strg+C)
echo.
node _system\automat.js
pause
