@echo off
chcp 65001 >nul

:: ============================================================
:: One-click Startup (background silent mode)
:: - Bundled node (tools\node\node.exe), no system PATH / Node install needed.
:: - Backend & frontend run hidden in background; this window auto-closes, no cmd windows left.
:: - Logs written to logs\ for troubleshooting.
:: - Stop/start uses .pid file + port, won't kill unrelated node processes.
:: - Backend collection proxy still read from .env, unaffected by proxy clearing below.
:: ============================================================

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

if exist "%ROOT%\tools\node\node.exe" (
  set "NODEEXE=%ROOT%\tools\node\node.exe"
) else (
  set "NODEEXE=node"
)

:: Clear system proxy interference with localhost (this session only; backend proxy from .env unaffected)
set HTTP_PROXY=
set HTTPS_PROXY=
set http_proxy=
set https_proxy=
set NO_PROXY=localhost,127.0.0.1
set no_proxy=localhost,127.0.0.1

:: Clean possible leftover old instances (by .pid + port, no false kills)
call :stop_by_pid "%ROOT%\server\.pid"
call :stop_by_pid "%ROOT%\creator-app\.pid"
powershell -NoProfile -WindowStyle Hidden -Command "foreach($port in @(3001,5173)){$c=Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue; if($c){$c.OwningProcess|Sort-Object -Unique|ForEach-Object{Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue}}}"

mkdir "%ROOT%\logs" 2>nul

echo ========================================
echo   Creator Studio - One-click Start (silent)
echo ========================================
echo.

echo [1/3] Starting backend in background...
powershell -NoProfile -WindowStyle Hidden -Command "Start-Process -FilePath '%NODEEXE%' -ArgumentList 'node_modules/tsx/dist/cli.mjs','src/index.ts' -WorkingDirectory '%ROOT%\server' -WindowStyle Hidden -RedirectStandardOutput '%ROOT%\logs\backend.out.log' -RedirectStandardError '%ROOT%\logs\backend.err.log' -PassThru | ForEach-Object { $_.Id } | Out-File -FilePath '%ROOT%\server\.pid' -Encoding ascii"
echo       Backend starting...

set /a BTRY=0
:wait_backend
set /a BTRY+=1
if %BTRY% gtr 20 (
  echo       [!] Backend no response in 40s, see logs\backend.err.log
  goto frontend_start
)
"%NODEEXE%" -e "fetch('http://127.0.0.1:3001/api/health').then(()=>process.exit(0)).catch(()=>process.exit(1))" >nul 2>&1
if %errorlevel%==0 goto backend_ok
timeout /t 2 /nobreak >nul
goto wait_backend
:backend_ok
echo       Backend ready OK

:frontend_start
echo [2/3] Starting frontend in background...
powershell -NoProfile -WindowStyle Hidden -Command "Start-Process -FilePath '%NODEEXE%' -ArgumentList 'node_modules/vite/bin/vite.js','--host' -WorkingDirectory '%ROOT%\creator-app' -WindowStyle Hidden -RedirectStandardOutput '%ROOT%\logs\frontend.out.log' -RedirectStandardError '%ROOT%\logs\frontend.err.log' -PassThru | ForEach-Object { $_.Id } | Out-File -FilePath '%ROOT%\creator-app\.pid' -Encoding ascii"
echo       Frontend starting...

set /a FTRY=0
:wait_frontend
set /a FTRY+=1
if %FTRY% gtr 20 (
  echo       [!] Frontend no response in 40s, see logs\frontend.err.log
  goto open_browser
)
"%NODEEXE%" -e "fetch('http://127.0.0.1:5173').then(()=>process.exit(0)).catch(()=>process.exit(1))" >nul 2>&1
if %errorlevel%==0 goto frontend_ok
timeout /t 2 /nobreak >nul
goto wait_frontend
:frontend_ok
echo       Frontend ready OK

:open_browser
echo [3/3] Opening browser...
start "" "http://127.0.0.1:5173"

echo.
echo Startup complete! Services run in background; this window will close.
echo DEV mode - open http://127.0.0.1:5173
echo Public site (production build) - https://creator.creator-app.xyz
echo To stop, run stop.ps1
timeout /t 2 /nobreak >nul
exit /b 0

:stop_by_pid
if not exist "%~1" goto :eof
for /f %%p in ('type "%~1"') do (
  taskkill /pid %%p /f /t >nul 2>&1
)
del "%~1" >nul 2>&1
goto :eof
