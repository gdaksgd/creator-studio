@echo off
rem One-click visit report for creator.creator-app.xyz
rem   Double-click            -> text report, last 7 days
rem   visit-report.bat 30     -> text report, last 30 days
rem   visit-report.bat 7 html -> generate the HTML report and open it in the browser
rem Requires: the SSH key %USERPROFILE%\.ssh\creator_hk_ed25519 (already on this PC).
chcp 65001 >nul
setlocal
set "DAYS=%~1"
if "%DAYS%"=="" set "DAYS=7"
set "MODE=%~2"
set "KEY=%USERPROFILE%\.ssh\creator_hk_ed25519"
set "HOST=root@47.82.100.178"
if not exist "%~dp0logs" mkdir "%~dp0logs"

if /i "%MODE%"=="html" (
  set "HTMLOUT=%~dp0logs\visits-report.html"
  echo.
  echo Generating HTML report ^(last %DAYS% days^) ...
  ssh -i "%KEY%" -o BatchMode=yes -o StrictHostKeyChecking=accept-new "%HOST%" "su -s /bin/bash creator -c 'node /opt/creator-studio/server/scripts/visits-html.mjs --days %DAYS%'" > "%HTMLOUT%" 2>"%HTMLOUT%.err"
  if errorlevel 1 (
    echo [ERROR] Could not generate the report. Detail:
    type "%HTMLOUT%.err"
  ) else (
    echo Saved to: %HTMLOUT%
    start "" "%HTMLOUT%"
  )
  echo.
  pause
  exit /b
)

set "OUT=%~dp0logs\visits-latest.txt"
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
