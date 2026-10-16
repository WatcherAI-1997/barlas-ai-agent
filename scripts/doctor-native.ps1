[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$RootDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$BarlasHome = Join-Path $env:LOCALAPPDATA "Barlas"
$NodeExe = Join-Path $BarlasHome "runtime\node\node.exe"
$EnvFile = Join-Path $RootDir "deploy\native.env"
$EntryPoint = Join-Path $RootDir "dist\src\native.js"

foreach ($Check in @(
    @{ Name = "Private Node.js runtime"; Path = $NodeExe },
    @{ Name = "Protected configuration"; Path = $EnvFile },
    @{ Name = "Native application build"; Path = $EntryPoint }
)) {
    if (-not (Test-Path -LiteralPath $Check.Path -PathType Leaf)) { throw "$($Check.Name) is missing: $($Check.Path)" }
    Write-Host "[OK] $($Check.Name)" -ForegroundColor Green
}

$Dashboard = & (Join-Path $RootDir "scripts\dashboard-url.ps1")
$ReadyUrl = ([string]$Dashboard -replace '/#token=.*$', '/ready')
try {
    $Response = Invoke-WebRequest -UseBasicParsing -Uri $ReadyUrl -TimeoutSec 5
    if ($Response.StatusCode -ne 200) { throw "Unexpected status $($Response.StatusCode)" }
} catch { throw "Barlas is not ready. Run scripts\start-native.ps1 -WaitReady" }
Write-Host "[OK] Native runtime is ready" -ForegroundColor Green
Write-Host "[OK] Docker and WSL are not used" -ForegroundColor Green
