@echo off
setlocal
title Second Brain - Autostart entfernen
set "VBS=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\SecondBrain-Autostart.vbs"
if exist "%VBS%" (
  del "%VBS%"
  echo Autostart entfernt.
) else (
  echo Es war kein Autostart eingerichtet.
)
echo Hinweis: Ein bereits laufender Server laeuft bis zum Abmelden weiter.
pause
