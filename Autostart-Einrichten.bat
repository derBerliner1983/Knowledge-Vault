@echo off
setlocal
title Second Brain - Autostart einrichten
cd /d "%~dp0"

rem --- Node.js finden ---------------------------------------------------------
set "NODEEXE="
for /f "delims=" %%i in ('where node 2^>nul') do if not defined NODEEXE set "NODEEXE=%%i"
if not defined NODEEXE if exist "%ProgramFiles%\nodejs\node.exe" set "NODEEXE=%ProgramFiles%\nodejs\node.exe"
if not defined NODEEXE (
  echo Node.js nicht gefunden - bitte zuerst "Installieren-und-Starten.bat" ausfuehren.
  pause
  exit /b 1
)

set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "VBS=%STARTUP%\SecondBrain-Autostart.vbs"

> "%VBS%" echo Set shell = CreateObject("Wscript.Shell")
>> "%VBS%" echo shell.CurrentDirectory = "%~dp0"
>> "%VBS%" echo shell.Run """%NODEEXE%"" ""%~dp0_system\server.js""", 0, False

echo.
echo Autostart eingerichtet:
echo   %VBS%
echo.
echo Ab der naechsten Windows-Anmeldung startet der Second-Brain-Server
echo automatisch und unsichtbar im Hintergrund - inklusive Automat
echo (Crontab-Regeln) und Live-Ueberwachung.
echo Die Ansicht ist dann immer unter http://localhost:7777 erreichbar.
echo.
echo Zum Entfernen: "Autostart-Entfernen.bat" doppelklicken.
echo.
pause
