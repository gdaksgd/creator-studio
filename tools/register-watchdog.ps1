#Requires -Version 5.1
# ============================================================
#  One-time setup for the home-machine deployment:
#
#    1. keep the machine awake on wall power (no sleep / hibernate)
#    2. register the 5-minute watchdog task "CreatorStudio-Watchdog"
#       (runs tools\watchdog.ps1; restarts backend / tunnel if down)
#
#  Safe to re-run (idempotent). Does NOT require admin; the task runs
#  in the current user's session, same as the Startup shortcut.
#
#  Run:  powershell -NoProfile -ExecutionPolicy Bypass -File tools\register-watchdog.ps1
#
#  NOTE: keep this file pure ASCII. Windows PowerShell 5.1 decodes
#  BOM-less script files with the system ANSI codepage (GBK here),
#  so non-ASCII bytes in the source can break parsing.
# ============================================================

$root     = Split-Path -Parent $PSScriptRoot
$taskName = 'CreatorStudio-Watchdog'

Write-Host '== 1/2  power: stay awake on AC =='
# 0 = never. The monitor is still allowed to turn off; system/disk stay up.
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
powercfg /change disk-timeout-ac 0

# Read back the "Current AC/DC Power Setting Index" values (seconds, 0 = never).
# powercfg output is localized, so do not match labels: the last two hex values
# on this query are always (AC current, DC current).
$hex = @((powercfg /query SCHEME_CURRENT SUB_SLEEP STANDBYIDLE 2>$null) |
    Select-String -Pattern '0x[0-9a-fA-F]{8}' -AllMatches |
    ForEach-Object { $_.Matches } | ForEach-Object { $_.Value })
$ac = if ($hex.Count -ge 2) { $hex[$hex.Count - 2] } else { '(unknown)' }
$dc = if ($hex.Count -ge 1) { $hex[$hex.Count - 1] } else { '(unknown)' }
Write-Host ("     standby-timeout  AC={0}  DC={1}   (0x00000000 = never)" -f $ac, $dc)
if ($ac -ne '0x00000000') {
    Write-Host '     [!] AC sleep is NOT disabled - right-click PowerShell, Run as administrator, re-run this script'
} else {
    Write-Host '     ok: system will not sleep while plugged in'
}

Write-Host '== 2/2  register the watchdog task =='
# schtasks is used on purpose: New-ScheduledTaskTrigger -RepetitionDuration MaxValue
# produces an out-of-range Duration (P99999999DT23H59M59S) on current Windows builds.
#
# The action goes through wscript.exe + watchdog-hidden.vbs on purpose:
# launching powershell.exe directly from Task Scheduler always flashes a
# console window (the console is created before -WindowStyle Hidden is read).
$vbs = Join-Path $PSScriptRoot 'watchdog-hidden.vbs'
if (-not (Test-Path -LiteralPath $vbs)) {
    Write-Host ("     [ERROR] missing {0}" -f $vbs)
    exit 1
}
$tr = 'wscript.exe "{0}"' -f $vbs
$out = schtasks.exe /Create /F /SC MINUTE /MO 5 /TN $taskName /TR $tr 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host ("     [ERROR] schtasks failed: {0}" -f ($out -join ' '))
    exit 1
}

# Report state via the .NET cmdlets (locale-independent).
$task = Get-ScheduledTask -TaskName $taskName
$info = Get-ScheduledTaskInfo -TaskName $taskName
Write-Host ("     ok: {0}  state={1}  every 5 min" -f $task.TaskName, $task.State)
Write-Host ("     next run: {0}" -f $info.NextRunTime)
Write-Host ''
Write-Host 'Watchdog log : logs\watchdog.log   (one STATUS line per run)'
Write-Host 'Uninstall    : schtasks /Delete /F /TN CreatorStudio-Watchdog'
