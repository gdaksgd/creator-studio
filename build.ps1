# ============================================================
#  Creator Studio - 生产构建
#  1. React hooks 顺序体检（防止运行期 "Rendered more hooks" 白屏）
#  2. 编译前端 -> creator-app/dist
#  3. 复制到 server/public，由 Express 托管
#
#  用法:  powershell -ExecutionPolicy Bypass -File build.ps1
# ============================================================

$root = $PSScriptRoot
$node = Join-Path $root 'tools\node\node.exe'
$app  = Join-Path $root 'creator-app'
$srv  = Join-Path $root 'server'
$dist = Join-Path $app 'dist'
$pub  = Join-Path $srv 'public'

Write-Host "========================================"
Write-Host "  Creator Studio - Build"
Write-Host "========================================"

if (-not (Test-Path -LiteralPath $node)) {
    Write-Host "[ERROR] node.exe not found: $node" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path -LiteralPath (Join-Path $app 'node_modules\vite\bin\vite.js'))) {
    Write-Host "[ERROR] creator-app dependencies missing. Run npm install first." -ForegroundColor Red
    exit 1
}

# ---------- 1. hooks-order guard ----------
Write-Host ""
Write-Host "[1/4] Checking React hooks order ..."
& $node (Join-Path $root 'tools\hooks-audit.mjs')
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] hooks-order check failed. Fix the violations above." -ForegroundColor Red
    exit 1
}

# ---------- 2. build frontend ----------
Write-Host ""
Write-Host "[2/4] Building frontend ..."
Push-Location $app
try {
    # 直接用内置 node 跑 vite，不依赖 npm
    & $node 'node_modules\typescript\bin\tsc' -b
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[ERROR] TypeScript build failed." -ForegroundColor Red
        Pop-Location
        exit 1
    }

    & $node 'node_modules\vite\bin\vite.js' build
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[ERROR] Vite build failed." -ForegroundColor Red
        Pop-Location
        exit 1
    }
} finally {
    Pop-Location
}

# ---------- 3. copy to server/public ----------
Write-Host ""
Write-Host "[3/4] Copying build to server\public ..."
if (Test-Path -LiteralPath $pub) {
    Remove-Item -LiteralPath $pub -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $pub | Out-Null
Copy-Item -Path (Join-Path $dist '*') -Destination $pub -Recurse -Force

# ---------- 4. report ----------
Write-Host ""
Write-Host "[4/4] Done."
$size = (Get-ChildItem -LiteralPath $pub -Recurse -File | Measure-Object Length -Sum).Sum
Write-Host ("  Output : " + $pub)
Write-Host ("  Size   : " + [math]::Round($size / 1KB, 1) + " KB")
Write-Host ""
Write-Host "Restart the backend so it serves the new build:"
Write-Host "  powershell -ExecutionPolicy Bypass -File stop.ps1"
Write-Host "  (then relaunch / or reboot - autostart handles it)"
