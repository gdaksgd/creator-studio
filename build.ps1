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
# 注意：不要「先删 public 再拷」——那中间有几秒网站 404，用户正好刷新就会打不开。
# 改成直接覆盖拷贝；旧 hash 资源保留 3 天再清，避免目录无限膨胀。
Write-Host ""
Write-Host "[3/4] Copying build to server\public ..."
New-Item -ItemType Directory -Force -Path $pub | Out-Null
Copy-Item -Path (Join-Path $dist '*') -Destination $pub -Recurse -Force
# Vite 产物没有 .gz；旧构建留下的预压缩副本会被 Express 优先命中，
# 导致线上 HTML 仍引用旧 bundle。统一清掉，服务下次启动会按新产物重建。
Get-ChildItem -LiteralPath $pub -Recurse -File -Filter '*.gz' | Remove-Item -Force
$assetsDir = Join-Path $pub 'assets'
if (Test-Path -LiteralPath $assetsDir) {
    $cutoff = (Get-Date).AddDays(-3)
    Get-ChildItem -LiteralPath $assetsDir -File |
        Where-Object { $_.LastWriteTime -lt $cutoff } |
        ForEach-Object {
            Write-Host ("  prune " + $_.Name)
            Remove-Item -LiteralPath $_.FullName -Force
        }
}

# ---------- 4. report ----------
Write-Host ""
Write-Host "[4/4] Done."
$size = (Get-ChildItem -LiteralPath $pub -Recurse -File | Measure-Object Length -Sum).Sum
Write-Host ("  Output : " + $pub)
Write-Host ("  Size   : " + [math]::Round($size / 1KB, 1) + " KB")
Write-Host ""
Write-Host "前端是静态文件，后端直接从磁盘读 server\public —— 构建完刷新浏览器即可，不用重启后端。"
Write-Host ""
Write-Host "只有改了 server\src 下的后端源码才需要重启（不要用 stop.ps1：结尾会 pause，还会一起杀掉 cloudflared）："
Write-Host "  Get-NetTCPConnection -LocalPort 3001 -State Listen | ForEach-Object { Stop-Process -Id `$_.OwningProcess -Force }"
Write-Host "  powershell -ExecutionPolicy Bypass -File autostart.ps1"
