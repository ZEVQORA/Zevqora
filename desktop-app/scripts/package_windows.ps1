$ErrorActionPreference = 'Stop'
$Root = Resolve-Path (Join-Path $PSScriptRoot '..')
$Backend = Join-Path $Root 'backend'
$Desktop = Join-Path $Root 'desktop'
$Venv = Join-Path $Backend '.venv-build'
$Python = Join-Path $Venv 'Scripts\python.exe'
$SidecarDir = Join-Path $Desktop 'resources\backend'

Write-Host 'Building ZEVQORA Desktop v1.1.0 for Windows...' -ForegroundColor Cyan

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
  --add-data "$(Join-Path $Backend 'alembic.ini');." `
  --add-data "$(Join-Path $Backend 'alembic');alembic" `
  run_backend.py
if ($LASTEXITCODE -ne 0) { throw 'PyInstaller failed to build the engine sidecar.' }

# The engine migrates its schema before it serves anything, so a sidecar that
# cannot find its Alembic files exits at startup and the app has no engine at
# all. Prove the built binary actually starts before wrapping it in an
# installer.
Write-Host 'Smoke-testing the packaged engine...' -ForegroundColor Cyan
$SidecarExe = Join-Path $SidecarDir 'zevqora-backend.exe'
if (-not (Test-Path $SidecarExe)) { throw "PyInstaller produced no engine at $SidecarExe." }
$SmokeHome = Join-Path $env:TEMP ("zevqora-sidecar-smoke-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $SmokeHome | Out-Null
$SmokeEnv = @{
    ZEVQORA_API_HOST  = '127.0.0.1'
    ZEVQORA_API_PORT  = '8099'
    ZEVQORA_API_TOKEN = 'packaging-smoke-token'
    DATABASE_URL      = "sqlite:///$($SmokeHome -replace '\\','/')/smoke.db"
}
foreach ($k in $SmokeEnv.Keys) { Set-Item -Path "env:$k" -Value $SmokeEnv[$k] }
$Smoke = Start-Process -FilePath $SidecarExe -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $SmokeHome 'out.log') `
    -RedirectStandardError (Join-Path $SmokeHome 'err.log')
$Healthy = $false
foreach ($attempt in 1..40) {
    Start-Sleep -Milliseconds 750
    if ($Smoke.HasExited) { break }
    try {
        $r = Invoke-WebRequest -Uri 'http://127.0.0.1:8099/api/health' -UseBasicParsing -TimeoutSec 3
        if ($r.StatusCode -eq 200) { $Healthy = $true; break }
    } catch { }
}
if (-not $Smoke.HasExited) { Stop-Process -Id $Smoke.Id -Force -ErrorAction SilentlyContinue }
if (-not $Healthy) {
    Write-Host '--- engine stdout ---' -ForegroundColor Yellow
    Get-Content (Join-Path $SmokeHome 'out.log') -Tail 40 -ErrorAction SilentlyContinue
    Write-Host '--- engine stderr ---' -ForegroundColor Yellow
    Get-Content (Join-Path $SmokeHome 'err.log') -Tail 40 -ErrorAction SilentlyContinue
    throw 'The packaged engine did not become healthy. Refusing to build an installer around it.'
}
Remove-Item $SmokeHome -Recurse -Force -ErrorAction SilentlyContinue
Write-Host 'Packaged engine started and answered /api/health.' -ForegroundColor Green

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
