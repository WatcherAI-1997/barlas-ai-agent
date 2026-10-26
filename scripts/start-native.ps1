[CmdletBinding()]
param([switch]$WaitReady)

$ErrorActionPreference = "Stop"
$RootDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$BarlasHome = Join-Path $env:LOCALAPPDATA "Barlas"
$NodeExe = Join-Path $BarlasHome "runtime\node\node.exe"
$EnvFile = Join-Path $RootDir "deploy\native.env"
$DataDir = Join-Path $BarlasHome "data"
$LogDir = Join-Path $BarlasHome "logs"
$PidFile = Join-Path $DataDir "barlas.pid"
$EntryPoint = Join-Path $RootDir "dist\src\native.js"

function Read-Setting([string]$Name) {
    $Prefix = "$Name="
    foreach ($Line in [IO.File]::ReadAllLines($EnvFile)) {
        if ($Line.StartsWith($Prefix, [StringComparison]::Ordinal)) {
            $Value = $Line.Substring($Prefix.Length)
            if ($Value.Length -ge 2 -and $Value[0] -eq "'" -and $Value[$Value.Length - 1] -eq "'") { return $Value.Substring(1, $Value.Length - 2).Replace("\'", "'") }
            return $Value.Trim('"')
        }
    }
    return ""
}

function Test-BarlasProcess($Candidate) {
    if (-not $Candidate -or -not $Candidate.ExecutablePath -or -not $Candidate.CommandLine) { return $false }
    $ExpectedNode = [IO.Path]::GetFullPath($NodeExe)
    $ActualNode = [IO.Path]::GetFullPath([string]$Candidate.ExecutablePath)
    if (-not $ActualNode.Equals($ExpectedNode, [StringComparison]::OrdinalIgnoreCase)) { return $false }
    $QuotedEntryPoint = '"' + [IO.Path]::GetFullPath($EntryPoint) + '"'
    return ([string]$Candidate.CommandLine).IndexOf($QuotedEntryPoint, [StringComparison]::OrdinalIgnoreCase) -ge 0
}

function Test-ListeningProcess([int]$Port, [int]$ProcessId) {
    $Listeners = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
    return @($Listeners | Where-Object { $_.OwningProcess -eq $ProcessId }).Count -gt 0
}

function Test-BarlasReady([int]$Port, [int]$ProcessId) {
    if (-not (Test-ListeningProcess $Port $ProcessId)) { return $false }
    try {
        $Response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/ready" -TimeoutSec 2
        return $Response.StatusCode -eq 200
    } catch { return $false }
}

function Stop-LaunchedProcess($LaunchedProcess) {
    $Candidate = Get-CimInstance Win32_Process -Filter "ProcessId = $($LaunchedProcess.Id)" -ErrorAction SilentlyContinue
    if (Test-BarlasProcess $Candidate) {
        Stop-Process -Id $LaunchedProcess.Id -Force -ErrorAction SilentlyContinue
        try { Wait-Process -Id $LaunchedProcess.Id -Timeout 10 -ErrorAction SilentlyContinue } catch { }
    }
    if (Test-Path -LiteralPath $PidFile -PathType Leaf) {
        $RecordedPid = [IO.File]::ReadAllText($PidFile).Trim()
        if ($RecordedPid -eq [string]$LaunchedProcess.Id) { Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue }
    }
}

if (-not (Test-Path -LiteralPath $NodeExe -PathType Leaf)) { throw "Barlas Node runtime is missing" }
if (-not (Test-Path -LiteralPath $EnvFile -PathType Leaf)) { throw "Barlas native configuration is missing" }
if (-not (Test-Path -LiteralPath $EntryPoint -PathType Leaf)) { throw "Barlas native build is missing" }
New-Item -ItemType Directory -Force -Path $DataDir, $LogDir | Out-Null
$PortText = Read-Setting "PORT"
if (-not $PortText) { $PortText = "17840" }
$Port = 0
if (-not ([int]::TryParse($PortText, [ref]$Port)) -or $Port -lt 1024 -or $Port -gt 65535) { throw "Barlas native PORT is invalid" }

if (Test-Path -LiteralPath $PidFile -PathType Leaf) {
    $ExistingPidText = [IO.File]::ReadAllText($PidFile).Trim()
    $ExistingPid = 0
    $ValidPid = [int]::TryParse($ExistingPidText, [ref]$ExistingPid) -and $ExistingPid -gt 0
    $Existing = if ($ValidPid) { Get-CimInstance Win32_Process -Filter "ProcessId = $ExistingPid" -ErrorAction SilentlyContinue } else { $null }
    if (Test-BarlasProcess $Existing) {
        if ($WaitReady -and -not (Test-BarlasReady $Port $ExistingPid)) { throw "Barlas process $ExistingPid is running but is not ready. Check $LogDir\native.error.log" }
        if ($WaitReady) { Write-Host "[OK] Barlas native runtime is ready" -ForegroundColor Green }
        else { Write-Host "Barlas is already running (PID $ExistingPid)." }
        return
    }
    Remove-Item -LiteralPath $PidFile -Force
}

$Arguments = "--env-file=`"$EnvFile`" `"$EntryPoint`""
$Process = Start-Process -FilePath $NodeExe -ArgumentList $Arguments -WorkingDirectory $RootDir -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $LogDir "native.out.log") -RedirectStandardError (Join-Path $LogDir "native.error.log")
[IO.File]::WriteAllText($PidFile, [string]$Process.Id, [Text.Encoding]::ASCII)

if ($WaitReady) {
    $Ready = $false
    for ($Attempt = 0; $Attempt -lt 90; $Attempt++) {
        Start-Sleep -Seconds 2
        if ($Process.HasExited) { break }
        if (Test-BarlasReady $Port $Process.Id) { $Ready = $true; break }
    }
    if (-not $Ready) {
        $Tail = if (Test-Path (Join-Path $LogDir "native.error.log")) { Get-Content (Join-Path $LogDir "native.error.log") -Tail 20 } else { @() }
        if ($Tail) { $Tail | Write-Host }
        Stop-LaunchedProcess $Process
        throw "Barlas did not become ready. Log: $LogDir\native.error.log"
    }
    Write-Host "[OK] Barlas native runtime is ready" -ForegroundColor Green
}
