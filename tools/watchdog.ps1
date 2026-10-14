#Requires -Version 5.1
# ============================================================
#  Creator Studio - watchdog (runs every 5 minutes)
#
#  Keeps the public site alive on the home machine:
#    1. backend :3001 not answering   -> (re)start it
#    2. cloudflared process not found -> (re)start the tunnel
#
#  Called by the scheduled task "CreatorStudio-Watchdog"
#  (registered once via tools\register-watchdog.ps1).
#  Logs: logs\watchdog.log  (auto-trimmed to the last ~300 lines)
#
#  Manual run:
#    powershell -NoProfile -ExecutionPolicy Bypass -File tools\watchdog.ps1
# ============================================================

$root    = Split-Path -Parent $PSScriptRoot        # tools\ -> project root
$node    = Join-Path $root 'tools\node\node.exe'
$cf      = Join-Path $root 'tools\cloudflared\cloudflared.exe'
$logDir  = Join-Path $root 'logs'
$logFile = Join-Path $logDir 'watchdog.log'

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Write-Log([string]$Message) {
    "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $Message" | Add-Content -LiteralPath $logFile -Encoding UTF8
}

# trim the log so it stays small (288 runs/day; keep ~1 day of history)
try {
    $lines = @(Get-Content -LiteralPath $logFile -ErrorAction SilentlyContinue)
    if ($lines.Count -gt 320) {
        $lines[-300..-1] | Set-Content -LiteralPath $logFile -Encoding UTF8
    }
} catch { }

# clear proxy vars so localhost is never swallowed by a system proxy
$env:HTTP_PROXY = ''; $env:HTTPS_PROXY = ''
$env:http_proxy = ''; $env:https_proxy = ''
$env:NO_PROXY = 'localhost,127.0.0.1'; $env:no_proxy = 'localhost,127.0.0.1'

function Test-Port([int]$Port) {
    [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

function Test-BackendHealth {
    try {
        $r = Invoke-WebRequest -Uri 'http://127.0.0.1:3001/api/health' -TimeoutSec 10 -UseBasicParsing
        return $r.StatusCode -eq 200
    } catch { return $false }
}

function Start-Backend {
    if (-not (Test-Path -LiteralPath $node)) {
        Write-Log "FAIL  node.exe not found: $node"
        return $false
    }
    Start-Process -FilePath $node `
        -ArgumentList 'node_modules/tsx/dist/cli.mjs', 'src/index.ts' `
        -WorkingDirectory (Join-Path $root 'server') -WindowStyle Hidden `
        -RedirectStandardOutput "$logDir\backend.out.log" `
        -RedirectStandardError  "$logDir\backend.err.log"
    for ($i = 0; $i -lt 20; $i++) {
        Start-Sleep -Seconds 2
        if (Test-Port 3001) { break }
    }
    return (Test-BackendHealth)
}

# ---------- 1. backend ----------
if (Test-Port 3001) {
    if (-not (Test-BackendHealth)) {
        Write-Log "WARN  backend port open but /api/health failing - restarting"
        $listener = Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue |
            Select-Object -First 1
        if ($listener) { Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue }
        Start-Sleep -Seconds 2
        if (Start-Backend) { Write-Log "OK    backend restarted, health ok" }
        else { Write-Log "FAIL  backend restart failed" }
    }
} else {
    Write-Log "WARN  backend not listening on 3001 - starting"
    if (Start-Backend) { Write-Log "OK    backend started, health ok" }
    else { Write-Log "FAIL  backend start failed" }
}

# ---------- 2. tunnel ----------
if (-not (Get-Process cloudflared -ErrorAction SilentlyContinue)) {
    if (-not (Test-Path -LiteralPath $cf)) {
        Write-Log "FAIL  cloudflared.exe not found: $cf"
    } else {
        Start-Process -FilePath $cf `
            -ArgumentList 'tunnel', 'run', 'creator-studio' -WindowStyle Hidden `
            -RedirectStandardOutput "$logDir\named-tunnel.out.log" `
            -RedirectStandardError  "$logDir\named-tunnel.err.log"
        Write-Log "OK    tunnel (re)started -> https://creator.creator-app.xyz"
    }
}

# ---------- 3. one status line per run (proves the watchdog itself is alive) ----------
$backendOk = Test-BackendHealth
$tunnelOk  = [bool](Get-Process cloudflared -ErrorAction SilentlyContinue)
Write-Log ("STATUS backend={0} tunnel={1}" -f $backendOk, $tunnelOk)
