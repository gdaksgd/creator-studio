#Requires -Version 5.1
<#
    Creator Studio - production smoke test
    --------------------------------------
    Verifies the invariants that matter in production:

      1. backend liveness        (/api/health)
      2. SPA is served           (/ returns index.html)
      3. no source-code leak     (a removed .tsx path must NOT return TSX)
      4. API 404 contract        (unknown /api/* returns JSON, not index.html)
      5. rate-limit headers      (X-RateLimit-* present on /api/*)
      6. sync status endpoint    (/api/sync/status)
      7. bundle is served        (hashed JS asset referenced by index.html)
      8. password is gone        (bundle must not contain the old secret)
      9. video stat endpoint     (/api/video/stat returns real data, own throttle)
     10. public URL (optional)   (same checks through the tunnel)

    Usage:
        powershell -NoProfile -ExecutionPolicy Bypass -File tools\smoke-test.ps1
        powershell -NoProfile -ExecutionPolicy Bypass -File tools\smoke-test.ps1 `
                   -PublicUrl https://creator.creator-app.xyz

    Exit code 0 = all checks passed, 1 = at least one failure.
#>
[CmdletBinding()]
param(
    [string] $BaseUrl   = 'http://127.0.0.1:3001',
    [string] $PublicUrl = ''
)

$ErrorActionPreference = 'Continue'
$script:Pass = 0
$script:Fail = 0
$script:OldSecret = '125' + '197'   # split so this file itself never contains it

function Write-Check {
    param([string] $Name, [bool] $Ok, [string] $Detail = '')
    $tag = if ($Ok) { 'PASS' } else { 'FAIL' }
    $colour = if ($Ok) { 'Green' } else { 'Red' }
    if ($Ok) { $script:Pass++ } else { $script:Fail++ }
    Write-Host ('  [{0}] {1,-38} {2}' -f $tag, $Name, $Detail) -ForegroundColor $colour
}

function Invoke-Probe {
    param([string] $Url, [switch] $WithHeaders)
    $tmp = [System.IO.Path]::GetTempFileName()
    try {
        $curlArgs = @('-s', '--noproxy', '*', '--max-time', '25', '-o', $tmp, '-w', '%{http_code}')
        if ($WithHeaders) {
            $hdrs = "$tmp.h"
            $curlArgs += @('-D', $hdrs)
        }
        $code  = & curl.exe @curlArgs $Url 2>$null
        $body  = ''
        if (Test-Path $tmp) { $body = Get-Content $tmp -Raw -Encoding UTF8 }
        $hdrText = ''
        if ($WithHeaders -and (Test-Path $hdrs)) { $hdrText = Get-Content $hdrs -Raw -Encoding UTF8 }
        if ($WithHeaders -and (Test-Path $hdrs)) { Remove-Item $hdrs -Force -ErrorAction SilentlyContinue }
        return [pscustomobject]@{
            Status  = [int] $code
            Body    = [string] $body
            Headers = [string] $hdrText
        }
    } finally {
        Remove-Item $tmp -Force -ErrorAction SilentlyContinue
    }
}

function Test-Site {
    param([string] $Label, [string] $Root)

    Write-Host ''
    Write-Host "== $Label ($Root)" -ForegroundColor Cyan

    $health = Invoke-Probe "$Root/api/health"
    Write-Check 'health endpoint' (($health.Status -eq 200) -and ($health.Body -match '"status"\s*:\s*"ok"')) `
                "HTTP $($health.Status)"

    $index = Invoke-Probe "$Root/"
    Write-Check 'SPA root served' (($index.Status -eq 200) -and ($index.Body -match 'id="root"')) `
                "HTTP $($index.Status), $($index.Body.Length) B"

    $leak = Invoke-Probe "$Root/src/components/PasswordGate.tsx"
    $isSource = $leak.Body -match 'useState|useEffect|export default|from ''react'''
    Write-Check 'no source-code leak' ((-not $isSource) -and ($leak.Body -match 'id="root"')) `
                "HTTP $($leak.Status), served index.html"

    $missing = Invoke-Probe "$Root/api/definitely-not-a-route"
    Write-Check 'API 404 contract' (($missing.Status -eq 404) -and ($missing.Body.TrimStart().StartsWith('{'))) `
                "HTTP $($missing.Status), JSON"

    $news = Invoke-Probe "$Root/api/news" -WithHeaders
    $hasRate = $news.Headers -match 'X-RateLimit-Limit'
    Write-Check 'rate-limit headers' (($news.Status -eq 200) -and $hasRate) `
                "HTTP $($news.Status)"

    $sync = Invoke-Probe "$Root/api/sync/status"
    Write-Check 'sync status endpoint' (($sync.Status -eq 200) -and ($sync.Body -match 'syncConfigured')) `
                "HTTP $($sync.Status), $($sync.Body.Trim())"

    $assetMatch = [regex]::Match($index.Body, '/assets/index-[A-Za-z0-9_\-]+\.js')
    if ($assetMatch.Success) {
        $asset = Invoke-Probe "$Root$($assetMatch.Value)"
        Write-Check 'bundle asset served' (($asset.Status -eq 200) -and ($asset.Body.Length -gt 100000)) `
                    "$($assetMatch.Value) HTTP $($asset.Status), $($asset.Body.Length) chars"
        Write-Check 'old password purged' (-not ($asset.Body -match [regex]::Escape($script:OldSecret))) `
                    'secret absent from bundle'
    } else {
        Write-Check 'bundle asset referenced' $false 'no /assets/index-*.js in index.html'
    }

    # ---- M1: publish-result backfill (/api/video/stat) -------------------
    # Hits the real Bilibili view endpoint, so this also proves the outbound path
    # works from the deployed backend.
    $vs = Invoke-Probe "$Root/api/video/stat?url=BV16io9YTEqH"
    $vsOk = $false
    $vsViews = 0
    if ($vs.Body) {
        try {
            $vsJson = $vs.Body | ConvertFrom-Json
            $vsOk = [bool] $vsJson.ok
            if ($vsJson.stat) { $vsViews = [int] $vsJson.stat.views }
        } catch { }
    }
    Write-Check 'video stat returns real data' `
                (($vs.Status -eq 200) -and $vsOk -and ($vsViews -gt 0)) `
                "HTTP $($vs.Status), views=$vsViews"

    $vsBad = Invoke-Probe "$Root/api/video/stat?url=not-a-video-link"
    Write-Check 'video stat rejects junk input' ($vsBad.Body -match '"code"\s*:\s*"BAD_INPUT"') `
                'code=BAD_INPUT'

    $vsGone = Invoke-Probe "$Root/api/video/stat?url=BV0000000000"
    Write-Check 'video stat reports missing video' ($vsGone.Body -match '"code"\s*:\s*"NOT_FOUND"') `
                'code=NOT_FOUND'

    $vsNoArg = Invoke-Probe "$Root/api/video/stat"
    Write-Check 'video stat requires url' ($vsNoArg.Status -eq 400) `
                "HTTP $($vsNoArg.Status)"

    $vsHdr = Invoke-Probe "$Root/api/video/stat?url=BV16io9YTEqH" -WithHeaders
    Write-Check 'video route has own throttle' ($vsHdr.Headers -match 'X-RateLimit-Limit:\s*30') `
                'X-RateLimit-Limit: 30'
}

Write-Host ''
Write-Host 'Creator Studio - smoke test' -ForegroundColor White
Write-Host ('Started {0:yyyy-MM-dd HH:mm:ss}' -f (Get-Date))

Test-Site -Label 'local (production backend)' -Root $BaseUrl

if ($PublicUrl) {
    Test-Site -Label 'public (cloudflare tunnel)' -Root $PublicUrl.TrimEnd('/')
} else {
    Write-Host ''
    Write-Host '== public URL skipped (-PublicUrl not supplied)' -ForegroundColor DarkGray
}

Write-Host ''
$total = $script:Pass + $script:Fail
if ($script:Fail -eq 0) {
    Write-Host "RESULT: $($script:Pass)/$total checks passed." -ForegroundColor Green
    exit 0
} else {
    Write-Host "RESULT: $($script:Pass)/$total passed, $($script:Fail) FAILED." -ForegroundColor Red
    exit 1
}
