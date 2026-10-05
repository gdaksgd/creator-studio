@echo off
setlocal

title Creator Studio - Frontend

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "APPDIR=%ROOT%\creator-app"

rem Optional:  this-script.bat 5199   -> start on a custom port
set "PORT=%~1"
if "%PORT%"=="" set "PORT=5173"

rem ---------- 1. locate node.exe: bundled node first, then system PATH ----------
set "NODEEXE="
if exist "%ROOT%\tools\node\node.exe" set "NODEEXE=%ROOT%\tools\node\node.exe"
if not defined NODEEXE for %%i in (node.exe) do if not "%%~$PATH:i"=="" set "NODEEXE=%%~$PATH:i"
if not defined NODEEXE (
  echo [ERROR] Node.js not found.
  echo         Expected: %ROOT%\tools\node\node.exe
  echo         Or add node.exe to your system PATH.
  pause
  exit /b 1
)

rem ---------- 2. check project files ----------
if not exist "%APPDIR%\package.json" (
  echo [ERROR] Missing "%APPDIR%\package.json"
  pause
  exit /b 1
)
if not exist "%APPDIR%\node_modules\vite\bin\vite.js" (
  echo [ERROR] Dependencies missing: node_modules\vite not found.
  echo         Run:  cd /d "%APPDIR%"   then   npm install
  pause
  exit /b 1
)

rem ---------- 3. port already in use? ----------
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
if not errorlevel 1 (
  echo [!] Port %PORT% is already in use - the frontend is probably running.
  echo     To restart, stop the old process first.
  echo     Opening browser now: http://127.0.0.1:%PORT%
  start "" "http://127.0.0.1:%PORT%"
  pause
  exit /b 0
)

cd /d "%APPDIR%"

rem system proxy can swallow localhost requests - clear it for this window only
set "HTTP_PROXY="
set "HTTPS_PROXY="
set "http_proxy="
set "https_proxy="
set "NO_PROXY=localhost,127.0.0.1"
set "no_proxy=localhost,127.0.0.1"

echo ========================================
echo   Creator Studio - Frontend
echo ========================================
echo   Node : %NODEEXE%
echo   Dir  : %APPDIR%
echo   URL  : http://127.0.0.1:%PORT%
echo.
echo   Press Ctrl+C to stop.
echo.

rem --host is required: without it vite binds to ::1 only and 127.0.0.1 will not respond
"%NODEEXE%" "node_modules\vite\bin\vite.js" --host --port %PORT%
set "EC=%errorlevel%"

echo.
if not "%EC%"=="0" echo [!] Frontend exited with code %EC%
pause
exit /b %EC%
