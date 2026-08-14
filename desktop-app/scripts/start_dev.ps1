$ErrorActionPreference = 'Stop'
$Root = Resolve-Path (Join-Path $PSScriptRoot '..')

Write-Host ''
Write-Host 'ZEVQORA Desktop Premium v0.1'
Write-Host '-----------------------------'
if ([string]::IsNullOrWhiteSpace($env:OPENROUTER_API_KEY)) {
    Write-Host 'OPENROUTER_API_KEY is not set. Zev will run in LOCAL TOOLS ONLY mode.' -ForegroundColor Yellow
    Write-Host 'Set the key in the current shell or Windows user environment to enable full agentic chat.'
} else {
    Write-Host 'OpenRouter configuration detected.' -ForegroundColor Cyan
}
Write-Host ''

$BackendScript = Join-Path $Root 'scripts\start_backend.ps1'
$DesktopScript = Join-Path $Root 'scripts\start_desktop.ps1'

Start-Process powershell -ArgumentList '-NoExit', '-ExecutionPolicy', 'Bypass', '-File', $BackendScript
Start-Sleep -Seconds 2
Start-Process powershell -ArgumentList '-NoExit', '-ExecutionPolicy', 'Bypass', '-File', $DesktopScript
