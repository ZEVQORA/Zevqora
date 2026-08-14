$ErrorActionPreference = 'Stop'
$Root = Resolve-Path (Join-Path $PSScriptRoot '..')
$Backend = Join-Path $Root 'backend'
$Venv = Join-Path $Backend '.venv'
$Python = Join-Path $Venv 'Scripts\python.exe'

if (-not (Test-Path $Python)) {
    Write-Host 'Creating Python virtual environment...'
    python -m venv $Venv
}

& $Python -m pip install -r (Join-Path $Backend 'requirements.txt')
Set-Location $Backend
& $Python -m alembic upgrade head
Write-Host 'Starting ZEVQORA local API at http://127.0.0.1:8000'
& $Python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
