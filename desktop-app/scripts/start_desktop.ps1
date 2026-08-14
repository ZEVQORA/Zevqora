$ErrorActionPreference = 'Stop'
$Root = Resolve-Path (Join-Path $PSScriptRoot '..')
$Desktop = Join-Path $Root 'desktop'
Set-Location $Desktop

if (-not (Test-Path (Join-Path $Desktop 'node_modules'))) {
    Write-Host 'Installing desktop dependencies...'
    npm install
}

Write-Host 'Starting ZEVQORA Desktop...'
npm run dev
