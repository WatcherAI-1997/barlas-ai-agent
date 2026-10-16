[CmdletBinding()]
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)

$ErrorActionPreference = "Stop"
$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$NativeEnvFile = Join-Path $RootDir "deploy\native.env"
$BarlasHome = Join-Path $env:LOCALAPPDATA "Barlas"

function Read-Setting([string]$Path, [string]$Name) {
    $Prefix = "$Name="
    foreach ($Line in [IO.File]::ReadAllLines($Path)) {
        if ($Line.StartsWith($Prefix, [StringComparison]::Ordinal)) {
            $Value = $Line.Substring($Prefix.Length)
            if ($Value.Length -ge 2 -and $Value[0] -eq "'" -and $Value[$Value.Length - 1] -eq "'") { return $Value.Substring(1, $Value.Length - 2).Replace("\'", "'") }
            return $Value.Trim('"')
        }
    }
    return ""
}

if (Test-Path -LiteralPath $NativeEnvFile -PathType Leaf) {
    $NodeExe = Join-Path $BarlasHome "runtime\node\node.exe"
    if (-not (Test-Path -LiteralPath $NodeExe -PathType Leaf)) { throw "Barlas native runtime is missing. Run the one-line installer again." }
    $LocalCommand = if ($Arguments.Count -gt 0) { $Arguments[0] } else { "" }
    if ($LocalCommand -in @("start", "stop", "restart")) {
        if ($LocalCommand -in @("stop", "restart")) { & (Join-Path $RootDir "scripts\stop-native.ps1") }
        if ($LocalCommand -in @("start", "restart")) { & (Join-Path $RootDir "scripts\start-native.ps1") -WaitReady }
        exit 0
    }
    if ($LocalCommand -eq "dashboard") {
        $DashboardUrl = & (Join-Path $RootDir "scripts\dashboard-url.ps1")
        Start-Process ([string]$DashboardUrl).Trim()
        Write-Host "Barlas dashboard opened."
        exit 0
    }
    if ($LocalCommand -eq "logs") {
        $LogFile = Join-Path $BarlasHome "logs\native.out.log"
        if (-not (Test-Path -LiteralPath $LogFile -PathType Leaf)) { throw "Barlas log is not available yet." }
        if ($Arguments -contains "--follow") { Get-Content -LiteralPath $LogFile -Tail 100 -Wait }
        else { Get-Content -LiteralPath $LogFile -Tail 100 }
        exit 0
    }
    if ($LocalCommand -eq "update") {
        $UpdateScript = Join-Path ([IO.Path]::GetTempPath()) ("barlas-update-" + [Guid]::NewGuid().ToString("N") + ".ps1")
        try {
            Invoke-WebRequest -UseBasicParsing -Uri "https://raw.githubusercontent.com/WatcherAI-1997/barlas-ai-agent/main/install-windows.ps1" -OutFile $UpdateScript
            & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $UpdateScript
            exit $LASTEXITCODE
        } finally { Remove-Item -LiteralPath $UpdateScript -Force -ErrorAction SilentlyContinue }
    }
    $Port = Read-Setting $NativeEnvFile "PORT"
    $Token = Read-Setting $NativeEnvFile "BARLAS_GATEWAY_TOKEN"
    $env:BARLAS_URL = "http://127.0.0.1:$Port"
    $env:BARLAS_GATEWAY_TOKEN = $Token
    & $NodeExe (Join-Path $RootDir "dist\src\cli.js") @Arguments
    exit $LASTEXITCODE
}

$EnvFile = Join-Path $RootDir "deploy\local.env"
if (-not (Test-Path -LiteralPath $EnvFile -PathType Leaf)) {
    throw "Barlas is not configured. Run the one-line Windows installer first."
}
$env:BARLAS_ENV_FILE = $EnvFile
$ComposeArgs = @("compose", "-f", (Join-Path $RootDir "compose.production.yml"), "-f", (Join-Path $RootDir "compose.local.yml"), "--env-file", $EnvFile)
& docker @ComposeArgs exec api node dist/src/cli.js @Arguments
exit $LASTEXITCODE
