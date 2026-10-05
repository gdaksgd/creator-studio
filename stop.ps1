# Stop Creator Studio background services (backend :3001, frontend :5173)
$ports = @(3001, 5173)

Write-Output "========================================"
Write-Output "  Stop Creator Studio Service"
Write-Output "========================================"
Write-Output ""

# 1) Kill by .pid files (if they exist)
$root = Split-Path -Parent $MyInvocation.MyCommand.Definition
$pidFiles = @(
    (Join-Path $root "server\.pid"),
    (Join-Path $root "creator-app\.pid")
)
foreach ($pf in $pidFiles) {
    if (Test-Path $pf) {
        $pidVal = (Get-Content $pf -Raw).Trim()
        if ($pidVal -match '^\d+$') {
            Write-Output "  Kill by .pid file: PID $pidVal"
            Stop-Process -Id $pidVal -Force -ErrorAction SilentlyContinue
        }
        Remove-Item $pf -Force -ErrorAction SilentlyContinue
    }
}

# 2) Kill by listening port (gets the REAL listener PID, incl. tsx child)
Write-Output ""
Write-Output "[*] Killing processes listening on ports 3001 / 5173 ..."
foreach ($port in $ports) {
    $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if ($conns) {
        foreach ($p in ($conns.OwningProcess | Sort-Object -Unique)) {
            Write-Output "  -> Kill PID $p (port $port)"
            Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
        }
    } else {
        Write-Output "  (no listener on port $port)"
    }
}

# 3) Kill Cloudflare tunnel
Write-Output ""
Write-Output "[*] Killing cloudflared tunnel ..."
$cfProcs = Get-Process cloudflared -ErrorAction SilentlyContinue
if ($cfProcs) {
    foreach ($p in $cfProcs) {
        Write-Output "  -> Kill cloudflared PID $($p.Id)"
        Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
    }
} else {
    Write-Output "  (no cloudflared running)"
}

# 4) Verify
Start-Sleep -Seconds 1
Write-Output ""
Write-Output "[*] Verifying ..."
$still = $false
foreach ($port in $ports) {
    $c = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if ($c) {
        Write-Output "  [!] Port $port STILL in use (PID $(($c.OwningProcess -join ',')))"
        $still = $true
    } else {
        Write-Output "  [ok] Port $port released"
    }
}

Write-Output ""
if ($still) {
    Write-Output "Some ports still occupied. Please right-click and 'Run as administrator'."
} else {
    Write-Output "All ports released. Service stopped."
}

Write-Output ""
Write-Output "Done. Press any key to close this window."
try { cmd /c pause >nul } catch {}
