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

function Open-VoiceTest {
    $DashboardUrl = ([string](& (Join-Path $RootDir "scripts\dashboard-url.ps1"))).Trim()
    $HashIndex = $DashboardUrl.IndexOf("#", [StringComparison]::Ordinal)
    $BaseUrl = if ($HashIndex -ge 0) { $DashboardUrl.Substring(0, $HashIndex) } else { $DashboardUrl }
    $Fragment = if ($HashIndex -ge 0) { $DashboardUrl.Substring($HashIndex) } else { "" }
    $Separator = if ($BaseUrl.Contains("?")) { "&" } else { "?" }
    Start-Process "$BaseUrl${Separator}voice-test=1$Fragment"
    Write-Host "Barlas voice check opened. The microphone stays off until you press the test button." -ForegroundColor Cyan
}

if (Test-Path -LiteralPath $NativeEnvFile -PathType Leaf) {
    $NodeExe = Join-Path $BarlasHome "runtime\node\node.exe"
    if (-not (Test-Path -LiteralPath $NodeExe -PathType Leaf)) { throw "Barlas native runtime is missing. Run the one-line installer again." }
    $Port = Read-Setting $NativeEnvFile "PORT"
    $Token = Read-Setting $NativeEnvFile "BARLAS_GATEWAY_TOKEN"
    $LocalCommand = if ($Arguments.Count -gt 0) { $Arguments[0] } else { "" }
    $ConfigureScript = Join-Path $RootDir "scripts\configure-native.ps1"
    if ($LocalCommand -in @("onboard", "configure")) {
        $Profiles = @("complete", "quick", "private", "developer", "server", "import")
        $Requested = if ($Arguments.Count -gt 1) { $Arguments[1] } else { "" }
        $Section = if ($LocalCommand -eq "onboard" -or $Requested -in $Profiles -or -not $Requested) { "all" } else { $Requested }
        $Profile = if ($Requested -in $Profiles) { $Requested } else { "" }
        & $ConfigureScript -Action wizard -Section $Section -Profile $Profile
        if (-not $?) { exit 1 }
        & $ConfigureScript -Action validate
        if (-not $?) { exit 1 }
        & (Join-Path $RootDir "scripts\stop-native.ps1")
        & (Join-Path $RootDir "scripts\start-native.ps1") -WaitReady
        & (Join-Path $RootDir "scripts\doctor-native.ps1") -RequireRunning
        Write-Host "`n[OK] Barlas is configured and ready." -ForegroundColor Green
        if ($Section -eq "all") {
            $OpenVoiceCheck = Read-Host "Open the private microphone and voice check now? [Y/n]"
            if ($OpenVoiceCheck -notmatch "^(n|no|нет)$") { Open-VoiceTest }
        }
        exit 0
    }
    if ($LocalCommand -eq "config") {
        $ConfigAction = if ($Arguments.Count -gt 1) { $Arguments[1] } else { "list" }
        $ConfigKey = if ($Arguments.Count -gt 2) { $Arguments[2] } else { "" }
        $ConfigValue = if ($Arguments.Count -gt 3) { ($Arguments[3..($Arguments.Count - 1)] -join " ") } else { "" }
        & $ConfigureScript -Action $ConfigAction -Key $ConfigKey -Value $ConfigValue
        if (-not $?) { exit 1 }
        if ($ConfigAction -in @("set", "unset")) {
            & (Join-Path $RootDir "scripts\stop-native.ps1")
            & (Join-Path $RootDir "scripts\start-native.ps1") -WaitReady
        }
        exit 0
    }
    if ($LocalCommand -eq "models" -and $Arguments.Count -gt 1 -and $Arguments[1] -in @("status", "configure", "login", "logout", "auth-status")) {
        if ($Arguments[1] -eq "status") { & $ConfigureScript -Action models-status }
        elseif ($Arguments[1] -in @("login", "logout", "auth-status")) {
            $AuthAction = if ($Arguments[1] -eq "auth-status") { "status" } else { $Arguments[1] }
            & (Join-Path $RootDir "scripts\model-auth-native.ps1") -Action $AuthAction
        }
        else {
            & $ConfigureScript -Action wizard -Section models
            if ($?) { & (Join-Path $RootDir "scripts\stop-native.ps1"); & (Join-Path $RootDir "scripts\start-native.ps1") -WaitReady }
        }
        if ($?) { exit 0 }
        exit 1
    }
    if ($LocalCommand -eq "channels" -and $Arguments.Count -gt 1 -and $Arguments[1] -in @("status", "add", "configure")) {
        if ($Arguments[1] -eq "status") { & $ConfigureScript -Action channels-status }
        else {
            & $ConfigureScript -Action wizard -Section channels
            if ($?) { & (Join-Path $RootDir "scripts\stop-native.ps1"); & (Join-Path $RootDir "scripts\start-native.ps1") -WaitReady }
        }
        if ($?) { exit 0 }
        exit 1
    }
    if ($LocalCommand -eq "security" -and $Arguments.Count -gt 1 -and $Arguments[1] -eq "audit") {
        & $ConfigureScript -Action security-audit
        exit $LASTEXITCODE
    }
    if ($LocalCommand -eq "node" -and $Arguments.Count -gt 1 -and $Arguments[1] -in @("install", "uninstall")) {
        $NodeScript = Join-Path $RootDir "scripts\windows-node.ps1"
        if ($Arguments[1] -eq "uninstall") { & $NodeScript -Uninstall; exit $LASTEXITCODE }
        $Headers = @{ Authorization = "Bearer $Token" }
        $Me = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/v1/me" -Headers $Headers -TimeoutSec 10
        $Pairing = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$Port/v1/nodes/pairing-code" -Headers $Headers -ContentType "application/json" -Body (@{ userId = $Me.principal.id } | ConvertTo-Json -Compress) -TimeoutSec 10
        & $NodeScript -Configure -BaseUrl "http://127.0.0.1:$Port" -PairingCode $Pairing.code
        if (-not $?) { exit 1 }
        Start-Process powershell.exe -ArgumentList @("-NoProfile", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-File", "`"$NodeScript`"")
        exit 0
    }
    if ($LocalCommand -in @("gateway", "daemon")) {
        $GatewayCommand = if ($Arguments.Count -gt 1) { $Arguments[1] } else { "status" }
        if ($GatewayCommand -in @("start", "run", "stop", "restart")) {
            if ($GatewayCommand -in @("stop", "restart")) { & (Join-Path $RootDir "scripts\stop-native.ps1") }
            if ($GatewayCommand -in @("start", "run", "restart")) { & (Join-Path $RootDir "scripts\start-native.ps1") -WaitReady }
            exit 0
        }
        if ($GatewayCommand -eq "status") {
            try {
                $Response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/ready" -TimeoutSec 3
                if ($Response.StatusCode -eq 200) { Write-Host "Barlas Gateway: running" -ForegroundColor Green; exit 0 }
            } catch { }
            Write-Host "Barlas Gateway: stopped" -ForegroundColor Yellow
            exit 1
        }
        if ($GatewayCommand -eq "health") { & (Join-Path $RootDir "scripts\doctor-native.ps1"); exit $LASTEXITCODE }
        if ($GatewayCommand -eq "logs") {
            $LogFile = Join-Path $BarlasHome "logs\native.out.log"
            if (-not (Test-Path -LiteralPath $LogFile -PathType Leaf)) { throw "Barlas Gateway log is not available yet." }
            if ($Arguments -contains "--follow") { Get-Content -LiteralPath $LogFile -Tail 100 -Wait }
            else { Get-Content -LiteralPath $LogFile -Tail 100 }
            exit 0
        }
        throw "Unknown gateway command. Use: status, start, stop, restart, health, logs"
    }
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
    if ($LocalCommand -eq "voice" -and $Arguments.Count -gt 1 -and $Arguments[1] -eq "test") {
        Open-VoiceTest
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
        $UpdateAction = if ($Arguments.Count -gt 1) { $Arguments[1] } else { "update" }
        & (Join-Path $RootDir "scripts\update-native.ps1") -Action $UpdateAction
        exit $LASTEXITCODE
    }
    if ($LocalCommand -eq "repair") {
        & (Join-Path $RootDir "scripts\update-native.ps1") -Action repair
        exit $LASTEXITCODE
    }
    if ($LocalCommand -eq "uninstall") {
        $Purge = $Arguments -contains "--purge"
        & (Join-Path $RootDir "scripts\uninstall-native.ps1") -PurgeData:$Purge
        exit $LASTEXITCODE
    }
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
