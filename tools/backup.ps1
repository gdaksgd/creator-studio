#Requires -Version 5.1
# ============================================================
#  Supabase app_sync daily backup
#
#  Pulls the whole `app_sync` row (select=data,uploaded_at) and
#  stores it as  backups\app_sync-YYYY-MM-DD.json
#  Keeps the last 30 days, appends one line to logs\backup.log
#  in the form:  <time>  OK/FAIL  <what>  <file size>
#
#  Usage:
#    powershell -NoProfile -ExecutionPolicy Bypass -File tools\backup.ps1
#         -> does its own fetch with curl.exe
#    powershell ... -File tools\backup.ps1 -ResponseFile <path> -HttpCode 200
#         -> reuses a response body that keepalive.ps1 already fetched,
#            so the daily task only makes ONE network request.
#
#  Idempotent: running it twice on the same day simply overwrites that
#  day's file. A failed fetch/validation NEVER touches an existing file.
#
#  Depends on nothing but what ships with Windows: PowerShell 5.1 + curl.exe.
# ============================================================
[CmdletBinding()]
param(
    # Already-fetched response body (PostgREST JSON array). When omitted the
    # script fetches the row itself.
    [string]$ResponseFile,
    # HTTP status code belonging to -ResponseFile.
    [string]$HttpCode
)

$ErrorActionPreference = 'Stop'

# Comments/log text are kept ASCII on purpose: Windows PowerShell 5.1 reads
# .ps1 files using the ANSI code page unless they carry a UTF-8 BOM.

$root       = Split-Path -Parent $PSScriptRoot          # tools\ -> project root
$envFile    = Join-Path $root 'server\.env'
$backupsDir = Join-Path $root 'backups'
$logFile    = Join-Path $root 'logs\backup.log'
$selectCols = 'data,uploaded_at'
$keepDays   = 30

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $logFile) | Out-Null
New-Item -ItemType Directory -Force -Path $backupsDir | Out-Null

function Write-BackupLog([string]$Text) {
    "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $Text" |
        Add-Content -LiteralPath $logFile -Encoding UTF8
}

# Drop backups older than $keepDays. Date comes from the file name, so the
# result does not depend on filesystem timestamps.
function Remove-ExpiredBackups {
    $cutoff = (Get-Date).Date.AddDays(-$keepDays)
    $files = @(Get-ChildItem -LiteralPath $backupsDir -Filter 'app_sync-*.json' -File -ErrorAction SilentlyContinue)
    foreach ($f in $files) {
        $m = [regex]::Match($f.BaseName, '^app_sync-(\d{4}-\d{2}-\d{2})$')
        if (-not $m.Success) { continue }
        try {
            $day = [datetime]::ParseExact(
                $m.Groups[1].Value, 'yyyy-MM-dd', [System.Globalization.CultureInfo]::InvariantCulture)
        } catch { continue }
        if ($day.Date -lt $cutoff) {
            Remove-Item -LiteralPath $f.FullName -Force -ErrorAction SilentlyContinue
            Write-BackupLog "OK    pruned expired backup: $($f.Name)  -"
        }
    }
}

$exitCode = 1
$ownTmp = $null       # temp file we created ourselves and must delete
$body = $ResponseFile

try {
    if ($body) {
        if (-not (Test-Path -LiteralPath $body)) {
            throw "response file not found: $body"
        }
        $code = if ($HttpCode) { "$HttpCode".Trim() } else { '200' }
        $source = 'keepalive.ps1 (single shared request)'
    } else {
        if (-not (Test-Path -LiteralPath $envFile)) {
            throw "server\.env not found: $envFile"
        }
        $txt = Get-Content -LiteralPath $envFile -Raw
        $url = [regex]::Match($txt, 'SUPABASE_URL=(\S+)').Groups[1].Value
        $key = [regex]::Match($txt, 'SUPABASE_ANON_KEY=(\S+)').Groups[1].Value
        if (-not $url -or -not $key) {
            throw 'SUPABASE_URL / SUPABASE_ANON_KEY not configured in server\.env'
        }

        # Write the body into %TEMP% (ASCII path) and move it with PowerShell
        # afterwards: curl.exe handles non-ASCII -o paths unreliably.
        $ownTmp = Join-Path $env:TEMP ("app_sync-response-{0}.json" -f ([guid]::NewGuid().ToString('N')))
        $body = $ownTmp

        $curlArgs = @(
            '-s',
            '-o', $ownTmp,
            '-w', '%{http_code}',
            '--max-time', '60',
            '--noproxy', '*',
            "$url/rest/v1/app_sync?select=$selectCols&id=eq.1",
            '-H', "apikey: $key",
            '-H', "Authorization: Bearer $key"
        )
        $code = (& curl.exe @curlArgs | Out-String).Trim()
        if ($LASTEXITCODE -ne 0) {
            throw "curl.exe failed (exit $LASTEXITCODE, HTTP $code)"
        }
        $source = "$url/rest/v1/app_sync?select=$selectCols&id=eq.1"
    }

    if ($code -ne '200') {
        throw "HTTP $code"
    }

    $raw = Get-Content -LiteralPath $body -Raw -Encoding UTF8
    if ([string]::IsNullOrWhiteSpace($raw)) {
        throw 'empty response body'
    }

    # Validation. Anything unexpected stops us BEFORE a file is written, so a
    # broken response can never overwrite a good backup.
    $parsed = ConvertFrom-Json -InputObject $raw
    $rows = @($parsed)
    if ($rows.Count -eq 0 -or $null -eq $rows[0]) {
        throw 'cloud has no app_sync row yet (nothing to back up)'
    }
    $row = $rows[0]
    $names = @($row.PSObject.Properties.Name)
    if ($names -notcontains 'data') { throw 'response has no "data" field' }
    if ($names -notcontains 'uploaded_at') { throw 'response has no "uploaded_at" field' }
    if ($null -eq $row.data) { throw 'cloud row exists but its "data" is null' }

    $record = [ordered]@{
        backedUpAt  = (Get-Date).ToString('yyyy-MM-ddTHH:mm:sszzz')
        select      = $selectCols
        httpStatus  = 200
        uploaded_at = $row.uploaded_at
        data        = $row.data
    }
    if ($source) { $record['source'] = $source }

    $json = $record | ConvertTo-Json -Depth 100

    $stamp = (Get-Date).ToString('yyyy-MM-dd')
    $fileName = "app_sync-$stamp.json"
    $dest = Join-Path $backupsDir $fileName
    $destTmp = "$dest.tmp"

    # Write BOM-less UTF-8 (plain JSON, no byte-order mark).
    [System.IO.File]::WriteAllText($destTmp, $json, (New-Object System.Text.UTF8Encoding($false)))
    if ([System.IO.File]::Exists($dest)) { [System.IO.File]::Delete($dest) }
    [System.IO.File]::Move($destTmp, $dest)

    $size = (Get-Item -LiteralPath $dest).Length
    Write-BackupLog "OK    $fileName (uploaded_at=$($row.uploaded_at))  $size B"

    Remove-ExpiredBackups
    $exitCode = 0
}
catch {
    Write-BackupLog "FAIL  $($_.Exception.Message)  -"
    $exitCode = 1
}
finally {
    if ($ownTmp -and (Test-Path -LiteralPath $ownTmp)) {
        Remove-Item -LiteralPath $ownTmp -Force -ErrorAction SilentlyContinue
    }
}

exit $exitCode
