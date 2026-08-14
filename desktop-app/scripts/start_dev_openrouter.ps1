$ErrorActionPreference = 'Stop'
$SecureKey = Read-Host 'OpenRouter API key (input is hidden; not written to disk)' -AsSecureString
$Bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureKey)
try {
    $env:OPENROUTER_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($Bstr)
    & (Join-Path $PSScriptRoot 'start_dev.ps1')
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($Bstr)
    Remove-Item Env:OPENROUTER_API_KEY -ErrorAction SilentlyContinue
}
