@echo off
setlocal

title Creator Studio - Backend

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "SRVDIR=%ROOT%\server"
set "PORT=3001"

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
if not exist "%SRVDIR%\package.json" (
  echo [ERROR] Missing "%SRVDIR%\package.json"
  pause
  exit /b 1
)
if not exist "%SRVDIR%\node_modules\tsx\dist\cli.mjs" (
  echo [ERROR] Dependencies missing: node_modules\tsx not found.
  echo         Run:  cd /d "%SRVDIR%"   then   npm install
  pause
  exit /b 1
)

rem ---------- 3. port already in use? ----------
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
if not errorlevel 1 (
  echo [!] Port %PORT% is already in use - the backend is probably running.
  echo     To restart, stop the old process first.
  echo     Health check: http://127.0.0.1:%PORT%/api/health
  pause
  exit /b 0
)

cd /d "%SRVDIR%"

rem system proxy can swallow localhost requests - clear it for this window only
set "HTTP_PROXY="
set "HTTPS_PROXY="
set "http_proxy="
set "https_proxy="
set "NO_PROXY=localhost,127.0.0.1"
set "no_proxy=localhost,127.0.0.1"

echo ========================================
echo   Creator Studio - Backend
echo ========================================
echo   Node : %NODEEXE%
echo   Dir  : %SRVDIR%
echo   URL  : http://127.0.0.1:%PORT%
echo.
echo   Press Ctrl+C to stop.
echo.

"%NODEEXE%" "node_modules\tsx\dist\cli.mjs" watch src/index.ts
set "EC=%errorlevel%"

echo.
if not "%EC%"=="0" echo [!] Backend exited with code %EC%
pause
exit /b %EC%
