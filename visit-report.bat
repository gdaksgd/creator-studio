// One-click visit report for creator.creator-app.xyz
// Double-click: last 7 days. Or run: visit-report.bat 30 (last 30 days)
// Requires: the SSH key %USERPROFILE%\.ssh\creator_hk_ed25519 (already on this PC).
chcp 65001 >nul
setlocal
set "DAYS=%~1"
if "%DAYS%"=="" set "DAYS=7"
set "KEY=%USERPROFILE%\.ssh\creator_hk_ed25519"
set "HOST=root@47.82.100.178"
set "OUT=%~dp0logs\visits-latest.txt"
if not exist "%~dp0logs" mkdir "%~dp0logs"

echo.
echo Fetching visit report (last %DAYS% days) from the Hong Kong server...
echo.
ssh -i "%KEY%" -o BatchMode=yes -o StrictHostKeyChecking=accept-new "%HOST%" "su -s /bin/bash creator -c 'node /opt/creator-studio/server/scripts/visits.mjs --days %DAYS%'" > "%OUT%" 2>&1

if errorlevel 1 (
  echo [ERROR] Could not fetch the report. Network or server problem. Detail:
  echo ---------------------------------------------------------------
  type "%OUT%"
  echo ---------------------------------------------------------------
) else (
  type "%OUT%"
  echo.
  echo Report saved to: %OUT%
)
echo.
pause
