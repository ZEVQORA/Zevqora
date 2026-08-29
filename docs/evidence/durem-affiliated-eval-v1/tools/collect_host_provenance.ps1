<#
Capture measurement-host provenance for the DUREM affiliated evaluation.

Run this ON the real Sutainbuyant measurement host, from an ordinary PowerShell
prompt. It records hardware, OS, storage, the Lemonade runtime version, the
/v1/models response, and the hash of every model file it can locate.

Emits host_provenance.json. Contains no company data, no credentials, and no
user content -- safe to commit.

Usage:
    .\collect_host_provenance.ps1 -LemonadeBaseUrl "http://127.0.0.1:13305" -Out host_provenance.json
#>

param(
    [string]$LemonadeBaseUrl = "http://127.0.0.1:13305",
    [string]$Out = "host_provenance.json",
    [string[]]$ModelSearchPaths = @()
)

$ErrorActionPreference = "Continue"
$result = [ordered]@{}
$result.tool_version = "collect_host_provenance_v1"
$result.collected_at_utc = (Get-Date).ToUniversalTime().ToString("o")

# --- identity ------------------------------------------------------------
$cs  = Get-CimInstance Win32_ComputerSystem
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$os  = Get-CimInstance Win32_OperatingSystem

$result.hostname = $env:COMPUTERNAME
$result.machine  = "$($cs.Manufacturer) $($cs.Model)"
$result.cpu = [ordered]@{
    name           = $cpu.Name
    physical_cores = $cpu.NumberOfCores
    logical_cores  = $cpu.NumberOfLogicalProcessors
    max_clock_mhz  = $cpu.MaxClockSpeed
}
$result.ram_gb = [math]::Round($cs.TotalPhysicalMemory / 1GB, 2)
$result.os = [ordered]@{
    caption = $os.Caption
    version = $os.Version
    build   = $os.BuildNumber
}

# --- GPU / NPU -----------------------------------------------------------
$result.gpu = @(Get-CimInstance Win32_VideoController | ForEach-Object {
    [ordered]@{ name = $_.Name; driver_version = $_.DriverVersion; vram_mb = [math]::Round($_.AdapterRAM / 1MB, 0) }
})

# Ryzen AI / XDNA / Intel AI Boost all surface as PnP devices.
$result.npu = @(Get-CimInstance Win32_PnPEntity |
    Where-Object { $_.Name -match 'NPU|Neural|AI Boost|IPU|Ryzen AI|XDNA' } |
    ForEach-Object { [ordered]@{ name = $_.Name; device_id = $_.DeviceID; status = $_.Status } })
$result.npu_present = ($result.npu.Count -gt 0)

# --- storage relevant to model loading -----------------------------------
$result.storage = @(Get-CimInstance Win32_DiskDrive | ForEach-Object {
    [ordered]@{ model = $_.Model; interface = $_.InterfaceType; size_gb = [math]::Round($_.Size / 1GB, 1); media = $_.MediaType }
})
$result.volumes = @(Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | ForEach-Object {
    [ordered]@{ drive = $_.DeviceID; size_gb = [math]::Round($_.Size / 1GB, 1); free_gb = [math]::Round($_.FreeSpace / 1GB, 1) }
})

# --- Lemonade runtime ----------------------------------------------------
$lemonade = [ordered]@{}
$proc = Get-Process | Where-Object { $_.ProcessName -match 'lemonade' } | Select-Object -First 1
if ($proc) {
    $lemonade.process_name = $proc.ProcessName
    try {
        $lemonade.executable_path    = $proc.Path
        $lemonade.file_version       = (Get-Item $proc.Path).VersionInfo.FileVersion
        $lemonade.product_version    = (Get-Item $proc.Path).VersionInfo.ProductVersion
    } catch { $lemonade.executable_path = "unreadable" }
} else {
    $lemonade.process_name = $null
}

$cliVersion = $null
foreach ($exe in @("lemonade-server", "lemonade")) {
    $cmd = Get-Command $exe -ErrorAction SilentlyContinue
    if ($cmd) {
        try { $cliVersion = (& $exe --version 2>&1 | Out-String).Trim() } catch { }
        $lemonade.cli_path = $cmd.Source
        break
    }
}
$lemonade.cli_version = $cliVersion

try {
    $models = Invoke-RestMethod -Uri "$LemonadeBaseUrl/v1/models" -TimeoutSec 10
    $lemonade.models_endpoint_reachable = $true
    $lemonade.models_response = $models          # verbatim, as required by the contract
} catch {
    $lemonade.models_endpoint_reachable = $false
    $lemonade.models_error = $_.Exception.Message
}
$lemonade.base_url = $LemonadeBaseUrl
$result.lemonade = $lemonade

# --- model files ---------------------------------------------------------
# Hash every .gguf found. Hashing a multi-GB file takes a while; that is intended,
# because the model identity is part of the frozen contract.
$searchRoots = @()
if ($ModelSearchPaths.Count -gt 0) { $searchRoots = $ModelSearchPaths }
else {
    $searchRoots = @(
        "$env:LOCALAPPDATA\lemonade_server",
        "$env:USERPROFILE\.cache\lemonade",
        "$env:USERPROFILE\.cache\huggingface",
        "C:\Program Files\Lemonade Server"
    ) | Where-Object { Test-Path $_ }
}
$result.model_search_roots = $searchRoots

$models = @()
foreach ($root in $searchRoots) {
    Get-ChildItem -Path $root -Filter "*.gguf" -Recurse -ErrorAction SilentlyContinue |
        ForEach-Object {
            Write-Host "hashing $($_.Name) ..."
            $models += [ordered]@{
                file_name  = $_.Name
                full_path  = $_.FullName
                size_bytes = $_.Length
                size_gb    = [math]::Round($_.Length / 1GB, 3)
                sha256     = (Get-FileHash -Path $_.FullName -Algorithm SHA256).Hash
                modified   = $_.LastWriteTimeUtc.ToString("o")
            }
        }
}
$result.model_files = $models
$result.model_files_found = $models.Count

# --- idle power, if the platform exposes it ------------------------------
try {
    $battery = Get-CimInstance -Namespace root\wmi -ClassName BatteryStatus -ErrorAction Stop | Select-Object -First 1
    $result.power_draw_mw_instant = $battery.DischargeRate
    $result.power_telemetry_available = ($battery.DischargeRate -gt 0)
} catch {
    $result.power_telemetry_available = $false
    $result.power_note = "No platform power telemetry. Use an external wall meter for incremental_kW, or report the compute-cost proxy (COST_METHODOLOGY.md section 3)."
}

# --- verdict -------------------------------------------------------------
$result.qualifies_as_measurement_host = (
    $result.lemonade.models_endpoint_reachable -eq $true -and
    $result.model_files_found -gt 0 -and
    $result.ram_gb -ge 16
)
$result.qualification_criteria = "Lemonade /v1/models reachable AND at least one model file hashed AND RAM >= 16 GB"

$result | ConvertTo-Json -Depth 8 | Set-Content -Path $Out -Encoding UTF8
Write-Host ""
Write-Host "Wrote $Out"
Write-Host "qualifies_as_measurement_host = $($result.qualifies_as_measurement_host)"
