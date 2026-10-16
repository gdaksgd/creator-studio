# ============================================================
#  Deploy cs-supabase-proxy Worker and bind supabase.creator-app.xyz
#
#  Usage:
#    powershell -ExecutionPolicy Bypass -File deploy.ps1 -ApiToken <CF_API_TOKEN>
#  Idempotent: safe to re-run.
#
#  Token permissions required:
#    Account -> Workers Scripts -> Edit
#    Zone    -> Workers Routes  -> Edit
#    Zone    -> DNS             -> Edit
#  Zone Resources: Include -> creator-app.xyz
#
#  NOTE: keep this file ASCII-only. Windows PowerShell 5.1 (ACP 936) misparses
#  BOM-less UTF-8 scripts that contain non-ASCII characters.
# ============================================================
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$ApiToken,
  [string]$AccountId  = 'a788df5b661281f205ed9c0f909466f5',
  [string]$ZoneName   = 'creator-app.xyz',
  [string]$Hostname   = 'supabase.creator-app.xyz',
  [string]$ScriptName = 'cs-supabase-proxy',
  # Entry A: a path prefix on a hostname that ALREADY resolves from this machine. This is what
  # server\.env actually points at, because the local resolver NXDOMAINs brand-new subdomains
  # (aggressive NSEC negative cache upstream); see README.md.
  [string]$RouteHostname = 'creator.creator-app.xyz',
  [string]$RoutePrefix   = '/api/cs-cloud',
  [string]$EnvFile    = $null,
  [string]$WorkerFile = $null,
  [switch]$SkipEndToEnd
)
$ErrorActionPreference = 'Stop'
# Resolved in the body: $PSScriptRoot is not reliably populated inside param defaults on PS 5.1.
if (-not $WorkerFile) { $WorkerFile = Join-Path $PSScriptRoot 'worker.js' }
if (-not $EnvFile)    { $EnvFile    = Join-Path $PSScriptRoot '..\..\server\.env' }
$api = 'https://api.cloudflare.com/client/v4'

function Invoke-Cf {
  param([string]$Method, [string]$Path, [string]$Json)
  $a = @('-sS', '-m', '45', '-X', $Method, "$api$Path",
         '-H', "Authorization: Bearer $ApiToken",
         '-H', 'Content-Type: application/json')
  $tmp = $null
  if ($Json) {
    $tmp = Join-Path $env:TEMP ("cfbody-" + [guid]::NewGuid().ToString('N') + ".json")
    Set-Content -Path $tmp -Value $Json -Encoding ascii -NoNewline
    $a += @('--data-binary', "@$tmp")
  }
  $raw = (& curl.exe @a 2>&1) -join "`n"
  if ($tmp) { Remove-Item $tmp -Force -ErrorAction SilentlyContinue }
  try { return ($raw | ConvertFrom-Json) } catch { throw "Cloudflare API did not return JSON: $raw" }
}

function Show-Errors {
  param($resp)
  if ($resp.errors) { $resp.errors | ForEach-Object { "    ! [$($_.code)] $($_.message)" } }
}

Write-Host "== 1/6 verify token ==" -ForegroundColor Cyan
$v = Invoke-Cf GET '/user/tokens/verify'
if (-not $v.success) { Show-Errors $v; throw "Token verification failed" }
Write-Host "    token status: $($v.result.status)"

Write-Host "== 2/6 resolve zone ($ZoneName) ==" -ForegroundColor Cyan
$z = Invoke-Cf GET "/zones?name=$ZoneName"
if (-not $z.success) { Show-Errors $z; throw "Zone lookup failed (token may lack zone read access)" }
$zoneId = $z.result[0].id
if (-not $zoneId) { throw "Zone $ZoneName not found in this account" }
Write-Host "    zone_id = $zoneId"

Write-Host "== 3/6 upload worker ($ScriptName) ==" -ForegroundColor Cyan
if (-not (Test-Path $WorkerFile)) { throw "worker file not found: $WorkerFile" }
# curl.exe is a native tool: keep the multipart source paths ASCII-only, because the
# project directory name is non-ASCII and argv round-tripping of CJK paths is unreliable.
$stage = Join-Path $env:TEMP 'cs-supabase-proxy'
New-Item -ItemType Directory -Force -Path $stage | Out-Null
$stageWorker = Join-Path $stage 'worker.js'
$meta        = Join-Path $stage 'metadata.json'
Copy-Item -Path $WorkerFile -Destination $stageWorker -Force
Set-Content -Path $meta -Value '{"main_module":"worker.js","compatibility_date":"2025-09-01"}' -Encoding ascii -NoNewline
$up = (& curl.exe -sS -m 60 -X PUT "$api/accounts/$AccountId/workers/scripts/$ScriptName" `
        -H "Authorization: Bearer $ApiToken" `
        -F "metadata=@$meta;type=application/json" `
        -F "worker.js=@$stageWorker;type=application/javascript+module" 2>&1) -join "`n"
$upJson = $up | ConvertFrom-Json
if (-not $upJson.success) { Show-Errors $upJson; throw "Worker upload failed" }
Write-Host "    uploaded: $ScriptName"

Write-Host "== 4/6 bind custom hostname $Hostname ==" -ForegroundColor Cyan
$bindOk = $false
$d = Invoke-Cf PUT "/accounts/$AccountId/workers/domains" (@{
        environment = 'production'; hostname = $Hostname; service = $ScriptName; zone_id = $zoneId
      } | ConvertTo-Json -Compress)
if ($d.success) {
  $bindOk = $true
  Write-Host "    custom domain bound"
} else {
  Write-Host "    custom-domain API unavailable, falling back to DNS + Workers Route" -ForegroundColor Yellow
  Show-Errors $d
  $rec = Invoke-Cf POST "/zones/$zoneId/dns_records" (@{
           type = 'A'; name = ($Hostname -replace "\.$ZoneName$", ''); content = '192.0.2.1'; proxied = $true; ttl = 1
         } | ConvertTo-Json -Compress)
  if ($rec.success) { Write-Host "    dns record created (proxied A 192.0.2.1)" }
  else { Show-Errors $rec; Write-Host "    (dns record may already exist, continuing)" -ForegroundColor DarkYellow }
  $route = Invoke-Cf POST "/zones/$zoneId/workers/routes" (@{
             pattern = "$Hostname/*"; script = $ScriptName
           } | ConvertTo-Json -Compress)
  if ($route.success) { $bindOk = $true; Write-Host "    workers route bound" }
  else { Show-Errors $route }
}
if (-not $bindOk) { throw "binding the hostname failed" }

Write-Host "== 5/6 route $RouteHostname$RoutePrefix/* -> $ScriptName ==" -ForegroundColor Cyan
$pattern = "$RouteHostname$RoutePrefix/*"
$existing = Invoke-Cf GET "/zones/$zoneId/workers/routes"
$already = $false
if ($existing.success) {
  foreach ($r in $existing.result) { if ($r.pattern -eq $pattern) { $already = $true } }
}
if ($already) {
  Write-Host "    route already present"
} else {
  $route = Invoke-Cf POST "/zones/$zoneId/workers/routes" (@{ pattern = $pattern; script = $ScriptName } | ConvertTo-Json -Compress)
  if ($route.success) { Write-Host "    route created: $pattern" }
  else { Show-Errors $route; throw "creating the path-prefix route failed" }
}

Write-Host "== 6/6 end-to-end check ==" -ForegroundColor Cyan
$key = (Select-String -Path $EnvFile -Pattern '^SUPABASE_ANON_KEY=' -Encoding UTF8 | Select-Object -First 1).Line -replace '^SUPABASE_ANON_KEY=', ''
$key = $key.Trim('"').Trim("'")
if (-not $key) { throw "cannot read SUPABASE_ANON_KEY from $EnvFile" }
$probe = "https://$RouteHostname$RoutePrefix/rest/v1/app_sync?id=eq.1&select=id,uploaded_at"
$ok = $false
# curl.exe writes DNS/connection errors to stderr, which is normal for it. But with
# $ErrorActionPreference='Stop' above, PowerShell 5.1 turns native stderr into a
# terminating NativeCommandError -- that aborted the first deployment's poll loop while
# DNS was still missing. So relax it only for this block and restore it afterwards.
$savedEap = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try {
  foreach ($i in 1..10) {
    if ($SkipEndToEnd) { break }
    $r = (& curl.exe -sS -m 20 -w "`n__HTTP=%{http_code} tls=%{time_appconnect}s" `
            -H "apikey: $key" -H "Authorization: Bearer $key" $probe 2>&1) -join "`n"
    if ($r -match '__HTTP=200') {
      Write-Host "    200 OK (attempt $i)" -ForegroundColor Green
      Write-Host "    $($r.Split("`n")[0])"
      $ok = $true
      break
    }
    $line = ($r -replace "`n", ' ').Trim()
    Write-Host "    attempt $i not ready: $line" -ForegroundColor DarkYellow
    if ($line -match 'Could not resolve host') {
      Write-Host "    (DNS has not picked up $Hostname yet: an upstream resolver may be holding an aggressive NSEC negative cache, up to SOA minimum 1800s)" -ForegroundColor DarkYellow
    }
    Start-Sleep -Seconds 6
  }
} finally {
  $ErrorActionPreference = $savedEap
}
if (-not $ok -and -not $SkipEndToEnd) { throw "proxy hostname still not working; check that the worker is active" }
if ($SkipEndToEnd) { Write-Host "    skipped (-SkipEndToEnd)" -ForegroundColor DarkYellow }

Write-Host ""
Write-Host "Done. Next: set SUPABASE_URL=https://$RouteHostname$RoutePrefix in server\.env and restart the backend." -ForegroundColor Green
Write-Host "     (entry B https://$Hostname also works once its DNS record resolves everywhere.)" -ForegroundColor DarkGray
