$ErrorActionPreference = 'Stop'
$Root = Resolve-Path (Join-Path $PSScriptRoot '..')
$Backend = Join-Path $Root 'backend'
$Desktop = Join-Path $Root 'desktop'
$Venv = Join-Path $Backend '.venv-build'
$Python = Join-Path $Venv 'Scripts\python.exe'
$SidecarDir = Join-Path $Desktop 'resources\backend'

Write-Host 'Building ZEVQORA Production v1.0.7 for Windows...' -ForegroundColor Cyan

$ProjectRoot = Resolve-Path (Join-Path $Root '..')
Write-Host 'Running release preflight...' -ForegroundColor Cyan
& node (Join-Path $ProjectRoot 'scripts\verify-release.mjs')
if ($LASTEXITCODE -ne 0) { throw 'ZEVQORA release preflight failed.' }

if (-not (Test-Path $Python)) {
    python -m venv $Venv
}
& $Python -m pip install --upgrade pip
& $Python -m pip install -r (Join-Path $Backend 'requirements-build.txt')

if (Test-Path $SidecarDir) { Remove-Item $SidecarDir -Recurse -Force }
New-Item -ItemType Directory -Force -Path $SidecarDir | Out-Null

Set-Location $Backend
& $Python -m PyInstaller `
  --clean `
  --noconfirm `
  --onefile `
  --name zevqora-backend `
  --distpath $SidecarDir `
  --workpath (Join-Path $Backend 'build\pyinstaller') `
  --specpath (Join-Path $Backend 'build') `
  run_backend.py

Set-Location $Desktop
npm install --no-audit --no-fund
npm run dist:win

$Installer = Get-ChildItem (Join-Path $Desktop 'release') -Filter 'ZEVQORA-Setup-*.exe' |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if (-not $Installer) { throw 'electron-builder did not produce a ZEVQORA installer.' }
$Stable = Join-Path $Desktop 'release\ZEVQORA-Setup.exe'
Copy-Item $Installer.FullName $Stable -Force

Write-Host ''
Write-Host "Production installer ready: $Stable" -ForegroundColor Green
Write-Host 'The installer registers the zevqora:// desktop sign-in protocol.' -ForegroundColor Cyan
