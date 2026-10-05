# ============================================================
#  Creator Studio - AUTO START  (production mode)
#
#  Public site : https://creator.creator-app.xyz   (Express :3001)
#  Local dev   : http://localhost:5173             (Vite, see start-dev.bat)
#
#  Starts: backend (:3001, also serves the built frontend) + Cloudflare tunnel.
#  Everything runs hidden in the background. Logs -> logs\
#
#  Triggered on logon by the Startup shortcut. Can also be run
#  manually:  powershell -ExecutionPolicy Bypass -File autostart.ps1
# ============================================================

$root   = $PSScriptRoot
$node   = Join-Path $root 'tools\node\node.exe'
$cf     = Join-Path $root 'tools\cloudflared\cloudflared.exe'
$logDir = Join-Path $root 'logs'
$public = Join-Path $root 'server\public'

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

# clear proxy vars so localhost is never swallowed by a system proxy
$env:HTTP_PROXY  = ''
$env:HTTPS_PROXY = ''
$env:http_proxy  = ''
$env:https_proxy = ''
$env:NO_PROXY    = 'localhost,127.0.0.1'
$env:no_proxy    = 'localhost,127.0.0.1'

function Test-Port([int]$Port) {
    [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

# ---------- 0. build the frontend once, if it was never built ----------
if (-not (Test-Path -LiteralPath (Join-Path $public 'index.html'))) {
    Write-Output "[i] no production build found, building now ..."
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'build.ps1')
}

# ---------- 1. backend :3001 (serves API + the built frontend) ----------
if (Test-Port 3001) {
    Write-Output "[skip] backend already running"
} elseif (-not (Test-Path -LiteralPath $node)) {
    Write-Output "[ERROR] node.exe not found: $node"
} else {
    Start-Process -FilePath $node `
        -ArgumentList 'node_modules/tsx/dist/cli.mjs', 'src/index.ts' `
        -WorkingDirectory (Join-Path $root 'server') -WindowStyle Hidden `
        -RedirectStandardOutput "$logDir\backend.out.log" `
        -RedirectStandardError  "$logDir\backend.err.log"
    Write-Output "[ok] backend starting"
}

# ---------- 2. wait for the backend ----------
for ($i = 0; $i -lt 30; $i++) {
    if (Test-Port 3001) { break }
    Start-Sleep -Seconds 2
}
Write-Output "[i] backend: $(Test-Port 3001)"

# ---------- 3. Cloudflare tunnel (fixed domain) ----------
if (Get-Process cloudflared -ErrorAction SilentlyContinue) {
    Write-Output "[skip] tunnel already running"
} elseif (-not (Test-Path -LiteralPath $cf)) {
    Write-Output "[ERROR] cloudflared.exe not found: $cf"
} else {
    Start-Process -FilePath $cf `
        -ArgumentList 'tunnel', 'run', 'creator-studio' -WindowStyle Hidden `
        -RedirectStandardOutput "$logDir\named-tunnel.out.log" `
        -RedirectStandardError  "$logDir\named-tunnel.err.log"
    Write-Output "[ok] tunnel starting -> https://creator.creator-app.xyz"
}

Write-Output "[done] $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
