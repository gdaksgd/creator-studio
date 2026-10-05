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
     10. category benchmark      (/api/benchmark ships only samples with size + window)
     11. report generation       (/api/report/game-industry returns a sourced report)
     12. report markdown export  (.md carries sample sizes, no unsourced numbers)
     13. platform fit check      (/api/ai/evaluate-cover pure rules, every rule sourced)
     14. public URL (optional)   (same checks through the tunnel)

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
    param([string] $Url, [switch] $WithHeaders, [string] $JsonBody = '')
    $tmp = [System.IO.Path]::GetTempFileName()
    $bodyFile = ''
    try {
        $curlArgs = @('-s', '--noproxy', '*', '--max-time', '25', '-o', $tmp, '-w', '%{http_code}')
        if ($WithHeaders) {
            $hdrs = "$tmp.h"
            $curlArgs += @('-D', $hdrs)
        }
        if ($JsonBody -ne '') {
            # Windows curl strips the quotes out of a JSON string passed on the
            # command line, which makes body-parser return 400. Hand curl a file
            # with --data-binary instead: no shell/argv quoting involved at all.
            $bodyFile = "$tmp.body"
            [System.IO.File]::WriteAllText($bodyFile, $JsonBody, (New-Object System.Text.UTF8Encoding($false)))
            $curlArgs += @('-X', 'POST', '-H', 'Content-Type: application/json', '--data-binary', "@$bodyFile")
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
        if ($bodyFile -ne '') { Remove-Item $bodyFile -Force -ErrorAction SilentlyContinue }
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

    # ---- M2: category benchmark lines (/api/benchmark) ------------------
    # Guards the data-honesty rule: every published number must come from real
    # samples, so a shipped sample may never carry sampleSize 0.
    $bmReady = Invoke-Probe "$Root/api/benchmark/ready"
    $bmReadyOk = $false
    $bmSamples = @()
    if ($bmReady.Body) {
        try {
            $bmJson = $bmReady.Body | ConvertFrom-Json
            $bmReadyOk = [bool] $bmJson.ready
            if ($bmJson.samples) { $bmSamples = @($bmJson.samples) }
        } catch { }
    }
    Write-Check 'benchmark ready endpoint served' `
                (($bmReady.Status -eq 200) -and $bmReadyOk -and ($bmSamples.Count -gt 0)) `
                "HTTP $($bmReady.Status), ready=$bmReadyOk, samples=$($bmSamples.Count)"

    $bmShapeOk = $false
    if ($bmReady.Status -eq 200) {
        $bmPlain = Invoke-Probe "$Root/api/benchmark"
        $bmShapeOk = ($bmPlain.Status -eq 200) -and ($bmPlain.Body -match '"samples"')
    }
    Write-Check 'benchmark snapshot readable' $bmShapeOk 'GET /api/benchmark has samples'

    $badSample = @($bmSamples | Where-Object { $_.sampleSize -le 0 -or -not $_.sourceLabel -or -not $_.views })
    Write-Check 'benchmark never ships an empty sample' ($badSample.Count -eq 0) `
                "empty samples: $($badSample.Count)"

    $noWindow = @($bmSamples | Where-Object { $_.PSObject.Properties.Name -notcontains 'windowDays' })
    Write-Check 'benchmark sample carries size + window' ($noWindow.Count -eq 0) `
                "samples missing windowDays: $($noWindow.Count)"

    $thinCategory = @($bmSamples | Where-Object { $_.scope -eq 'category' -and $_.sampleSize -lt 15 })
    Write-Check 'benchmark category lines above threshold' ($thinCategory.Count -eq 0) `
                "thin category samples: $($thinCategory.Count)"

    $bmHdr = Invoke-Probe "$Root/api/benchmark" -WithHeaders
    Write-Check 'benchmark route has own throttle' ($bmHdr.Headers -match 'X-RateLimit-Limit:\s*30') `
                'X-RateLimit-Limit: 30'

    # ---- M3: analysis report (/api/report/game-industry) -----------------
    # The report is the deliverable that leaves the app (Markdown export), so the
    # data-honesty rule has to hold on the way out too: every number that ships
    # must still carry its sample size and window.
    $rep = Invoke-Probe "$Root/api/report/game-industry"
    $repOk = $false
    $repReady = $false
    $repCats = 0
    $repDays = 0
    $repMetrics = 0
    $repUnbacked = -1
    if ($rep.Body) {
        try {
            $repJson = $rep.Body | ConvertFrom-Json
            $repOk = [bool] $repJson.ok
            $repReady = [bool] $repJson.report.ready
            $repDays = [int] $repJson.report.days
            if ($repJson.report.categories) { $repCats = @($repJson.report.categories).Count }
            $repMetrics = [int] $repJson.report.selfCheck.metricCount
            $repUnbacked = [int] $repJson.report.selfCheck.unbackedMetricCount
        } catch { }
    }
    Write-Check 'report endpoint served' `
                (($rep.Status -eq 200) -and $repOk -and $repReady -and ($repCats -gt 0) -and ($repDays -eq 30)) `
                "HTTP $($rep.Status), ready=$repReady, categories=$repCats, days=$repDays"

    Write-Check 'report numbers all carry a source' `
                (($repUnbacked -eq 0) -and ($repMetrics -gt 0)) `
                "metrics=$repMetrics, without basis=$repUnbacked"

    # Note: this script is deliberately ASCII-only (PowerShell 5.1 reads .ps1 as
    # ANSI without a BOM, so non-ASCII literals would be mangled). The report
    # therefore publishes an ASCII self-check marker we can assert on:
    #   <!-- report-selfcheck ready=true metrics=64 unbacked=0 -->
    $md = Invoke-Probe "$Root/api/report/game-industry.md" -WithHeaders
    $mdSourced = ([regex]::Matches($md.Body, 'n=\d+')).Count -ge 6
    $mdClean = ($md.Body -match 'report-selfcheck ready=true metrics=\d+ unbacked=0')
    Write-Check 'report markdown export' `
                (($md.Status -eq 200) -and ($md.Headers -match 'text/markdown') -and $mdSourced -and $mdClean) `
                "HTTP $($md.Status), $($md.Body.Length) chars, sourced=$mdSourced"

    # ---- M4: platform fit check (/api/ai/evaluate-cover) -----------------
    # The rule engine is pure rules: it has to answer with NO AI call at all
    # (aiUsed=false), and every single rule must carry its own source, so the UI
    # can show where each verdict comes from. One script, two platforms, two
    # different length verdicts - that difference is the whole point of M4.
    # The probe payload is ASCII on purpose (see the ASCII note above).
    $coverProbe = '{"platform":"bilibili","title":"can a newbie play it","coverText":"from zero","durationSec":453}'
    $cover = Invoke-Probe "$Root/api/ai/evaluate-cover" -JsonBody $coverProbe
    $coverOk = $false
    $coverEngine = ''
    $coverAiUsed = $true
    $coverRules = 0
    $coverSourced = -1
    $coverTotal = -1
    $coverBiliMin = 0
    $coverBiliMax = 0
    $coverBiliPass = $false
    $coverAllSourced = $false
    if ($cover.Body) {
        try {
            $cj = $cover.Body | ConvertFrom-Json
            $coverOk = [bool] $cj.ok
            $coverEngine = [string] $cj.check.engine
            $coverAiUsed = [bool] $cj.aiUsed
            $coverRules = @($cj.check.rules).Count
            $coverSourced = [int] $cj.check.summary.sourced
            $coverTotal = [int] $cj.check.summary.total
            $coverBiliMin = [int] $cj.check.durationAdvice.targetSec[0]
            $coverBiliMax = [int] $cj.check.durationAdvice.targetSec[1]
            $coverBiliPass = ([string] $cj.check.durationAdvice.status -eq 'pass')
            $bad = @($cj.check.rules | Where-Object { -not $_.evidence.source -or ($_.evidence.level -notin @('A', 'B', 'C')) })
            $coverAllSourced = ($bad.Count -eq 0)
        } catch { }
    }
    Write-Check 'cover check runs without AI' `
                (($cover.Status -eq 200) -and $coverOk -and (-not $coverAiUsed) -and ($coverEngine -eq 'pure-rules-v1') -and ($coverRules -ge 8) -and ($coverSourced -eq $coverTotal)) `
                "HTTP $($cover.Status), engine=$coverEngine, aiUsed=$coverAiUsed, rules=$coverRules, sourced=$coverSourced/$coverTotal"

    Write-Check 'cover rules all carry a source' `
                ($coverAllSourced -and ($coverRules -gt 0)) `
                "every rule has evidence.source + A/B/C level = $coverAllSourced"

    $coverDy = Invoke-Probe "$Root/api/ai/evaluate-cover" -JsonBody '{"platform":"douyin","title":"can a newbie play it","coverText":"from zero","durationSec":453}'
    $dyMin = 0
    $dyMax = 0
    $dyWarn = $false
    $dyHint = $false
    if ($coverDy.Body) {
        try {
            $dj = $coverDy.Body | ConvertFrom-Json
            $dyMin = [int] $dj.check.durationAdvice.targetSec[0]
            $dyMax = [int] $dj.check.durationAdvice.targetSec[1]
            $dyWarn = ([string] $dj.check.durationAdvice.status -eq 'warn')
            $dyHint = [bool] $dj.check.durationAdvice.hint
        } catch { }
    }
    Write-Check 'cover length verdict is per platform' `
                (($coverBiliMin -eq 180) -and ($coverBiliMax -eq 600) -and $coverBiliPass -and ($dyMin -eq 60) -and ($dyMax -eq 180) -and $dyWarn -and $dyHint) `
                "bilibili $coverBiliMin-$coverBiliMax pass=$coverBiliPass; douyin $dyMin-$dyMax warn=$dyWarn hint=$dyHint"

    # Two things the engine must NOT do: invent a verdict for a platform it does
    # not know, and guess a cover verdict when no cover text was supplied.
    $coverBad = Invoke-Probe "$Root/api/ai/evaluate-cover" -JsonBody '{"platform":"kuaishou","title":"x","durationSec":300}'
    $coverNone = Invoke-Probe "$Root/api/ai/evaluate-cover" -JsonBody '{"platform":"bilibili","title":"x","durationSec":300}'
    $noneInfo = $false
    if ($coverNone.Body) {
        try {
            $nj = $coverNone.Body | ConvertFrom-Json
            $coverRule = @($nj.check.rules | Where-Object { $_.id -eq 'cover-emotion' })[0]
            $noneInfo = ([string] $coverRule.status -eq 'info') -and [bool] $coverRule.evidence.source
        } catch { }
    }
    Write-Check 'cover refuses to guess' `
                (($coverBad.Status -eq 400) -and ($coverBad.Body -match '"code"\s*:\s*"BAD_INPUT"') -and $noneInfo) `
                "unknown platform -> HTTP $($coverBad.Status); no cover text -> info+source=$noneInfo"

    # M4 fix: the panel re-checks while you type, so the pure-rule endpoint must NOT
    # sit behind the 20/min AI limiter (each pause fires bilibili + douyin).
    $coverLimit = 0
    $coverHdr = Invoke-Probe "$Root/api/ai/evaluate-cover" -WithHeaders -JsonBody '{"platform":"bilibili","title":"typing"}'
    if ($coverHdr.Headers -match 'X-RateLimit-Limit:\s*(\d+)') { $coverLimit = [int] $Matches[1] }
    Write-Check 'cover route has wide own throttle' `
                (($coverHdr.Status -eq 200) -and ($coverLimit -ge 100)) `
                "X-RateLimit-Limit: $coverLimit (the AI route itself stays at 20)"

    # Before the fix, checking more than 20 times a minute returned 429 and the
    # panel silently stopped updating. 25 back-to-back checks must all pass.
    $burstOk = 0
    $burstBad = 0
    foreach ($i in 1..25) {
        $b = Invoke-Probe "$Root/api/ai/evaluate-cover" -JsonBody '{"platform":"douyin","title":"typing burst","coverText":"from zero"}'
        if ($b.Status -eq 200) { $burstOk++ } else { $burstBad++ }
    }
    Write-Check 'cover checks survive typing burst' `
                (($burstOk -eq 25) -and ($burstBad -eq 0)) `
                "25 rapid checks (old AI cap was 20/min): 200=$burstOk, other=$burstBad"
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
