@echo off
setlocal

title Creator Studio - Fixed Domain

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "CF=%ROOT%\tools\cloudflared\cloudflared.exe"

if not exist "%CF%" (
  echo [ERROR] cloudflared.exe not found:
  echo         %CF%
  pause
  exit /b 1
)

rem the backend (which also serves the built frontend) must be running first
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
if errorlevel 1 (
  echo [ERROR] Nothing is listening on port 3001.
  echo         Start the backend first:  powershell -File autostart.ps1
  pause
  exit /b 1
)

rem do not start a second copy
tasklist /fi "IMAGENAME eq cloudflared.exe" 2>nul | find /i "cloudflared.exe" >nul && (
  echo Tunnel is already running. Nothing to do.
  pause
  exit /b 0
)

echo ========================================
echo   Creator Studio - Fixed Domain
echo ========================================
echo   Public URL : https://creator.creator-app.xyz
echo.
echo   This address is PERMANENT and never changes.
echo   Keep this window open. Press Ctrl+C to stop.
echo.

"%CF%" tunnel run creator-studio
pause
