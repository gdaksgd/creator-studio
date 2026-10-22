$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$project = (Resolve-Path (Join-Path $root "..\..")).Path
$venv = Join-Path $project "logs\tts-venv"
$python = Join-Path $venv "Scripts\python.exe"

if (-not (Test-Path $python)) {
  Write-Host "[tts-worker] creating venv at $venv"
  python -m venv $venv
  & $python -m pip install --disable-pip-version-check -r (Join-Path $root "requirements.txt")
}

& $python (Join-Path $root "worker.py") --host 127.0.0.1 --port 3101
