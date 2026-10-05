#Requires -Version 5.1
# ============================================================
#  Supabase keep-alive  +  daily app_sync backup
#
#  Free-plan Supabase projects are paused after 7 days of low
#  database activity. This runs one lightweight query so the
#  project stays awake, then hands the SAME response body to
#  tools\backup.ps1 - so the daily task makes only one network
#  request in total.
#
#  The old keep-alive query was  ?select=id&limit=1 ; it is now
#  ?select=data,uploaded_at&id=eq.1 (same single-row read, but it
#  carries the payload the backup needs). Keep-alive semantics are
#  unchanged: HTTP 200 means the database answered.
#
#  Called daily by the scheduled task "CreatorStudio-SupabaseKeepAlive".
#  Logs: logs\keepalive.log  and  logs\backup.log
#
#  Depends on nothing but what ships with Windows (PowerShell 5.1 + curl.exe).
# ============================================================

$root = Split-Path -Parent $PSScriptRoot      # tools\ -> project root

$envFile = Join-Path $root 'server\.env'
$logFile = Join-Path $root 'logs\keepalive.log'
$backupScript = Join-Path $PSScriptRoot 'backup.ps1'

New-Item -ItemType Directory -Force -Path (Join-Path $root 'logs') | Out-Null

function Write-Log([string]$Message) {
    "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $Message" | Add-Content -LiteralPath $logFile -Encoding UTF8
}

if (-not (Test-Path -LiteralPath $envFile)) {
    Write-Log "SKIP  server\.env not found"
    exit 0
}

$txt = Get-Content -LiteralPath $envFile -Raw
$url = [regex]::Match($txt, 'SUPABASE_URL=(\S+)').Groups[1].Value
$key = [regex]::Match($txt, 'SUPABASE_ANON_KEY=(\S+)').Groups[1].Value

if (-not $url -or -not $key) {
    Write-Log "SKIP  SUPABASE_URL / SUPABASE_ANON_KEY not configured"
    exit 0
}

# Keep the body in %TEMP% (ASCII path): curl.exe writes non-ASCII -o paths
# unreliably, and backup.ps1 only needs the bytes.
$tmp = Join-Path $env:TEMP ("app_sync-keepalive-{0}.json" -f ([guid]::NewGuid().ToString('N')))

# curl ignores the Windows system proxy; --noproxy forces a direct connection
$code = curl.exe -s -o $tmp -w "%{http_code}" --max-time 30 --noproxy "*" `
    "$url/rest/v1/app_sync?select=data,uploaded_at&id=eq.1" `
    -H "apikey: $key" -H "Authorization: Bearer $key"
$code = "$code".Trim()

if ($code -eq '200') {
    Write-Log "OK    keep-alive query succeeded (HTTP $code)"

    if (Test-Path -LiteralPath $backupScript) {
        # Separate process on purpose: backup.ps1 ends with `exit`, which would
        # otherwise terminate this script as well.
        & powershell -NoProfile -ExecutionPolicy Bypass -File $backupScript -ResponseFile $tmp -HttpCode $code
        if ($LASTEXITCODE -ne 0) {
            Write-Log "FAIL  backup step exited with code $LASTEXITCODE (see logs\backup.log)"
        } else {
            Write-Log "OK    daily backup step finished"
        }
    } else {
        Write-Log "SKIP  tools\backup.ps1 not found"
    }

    Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
    exit 0
} else {
    if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }
    Write-Log "FAIL  keep-alive query returned HTTP $code"
    exit 1
}
