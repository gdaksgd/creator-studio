@echo off
setlocal

title Creator Studio - Publish Update

rem Rebuild the frontend and restart the backend that serves it.
rem Public site: https://creator.creator-app.xyz

cd /d "%~dp0"

echo ========================================
echo   Publish Update
echo ========================================
echo.

echo [1/3] Building frontend ...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build.ps1"
if errorlevel 1 (
  echo.
  echo [ERROR] Build failed. Nothing was published.
  pause
  exit /b 1
)

echo.
echo [2/3] Restarting backend ...
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"
timeout /t 2 /nobreak >nul

echo [3/3] Starting services ...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0autostart.ps1"

echo.
echo Done. Open: https://creator.creator-app.xyz
echo (Cloudflare may take a few seconds to route to the new build.)
echo.
pause
