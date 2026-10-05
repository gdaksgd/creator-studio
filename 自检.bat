@echo off
rem Creator Studio - one-click health check.
rem Runs tools\smoke-test.ps1 against the local production backend
rem and the public Cloudflare tunnel URL.
setlocal
cd /d "%~dp0"

if /i "%~1"=="--no-public" (
  set "PUBLIC_URL="
) else (
  set "PUBLIC_URL=https://creator.creator-app.xyz"
)

where powershell.exe >nul 2>nul
if errorlevel 1 (
  echo [X] powershell.exe not found in PATH.
  pause
  exit /b 1
)

echo.
echo ============================================
echo   Creator Studio - smoke test
echo ============================================

if defined PUBLIC_URL (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\smoke-test.ps1" -PublicUrl "%PUBLIC_URL%"
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\smoke-test.ps1"
)

set "RC=%ERRORLEVEL%"
echo.
if "%RC%"=="0" (
  echo [OK] All checks passed.
) else (
  echo [X] Some checks FAILED - see above.
)
echo.
pause
exit /b %RC%
