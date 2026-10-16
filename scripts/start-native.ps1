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

if (-not (Test-Path -LiteralPath $NodeExe -PathType Leaf)) { throw "Barlas Node runtime is missing" }
if (-not (Test-Path -LiteralPath $EnvFile -PathType Leaf)) { throw "Barlas native configuration is missing" }
if (-not (Test-Path -LiteralPath $EntryPoint -PathType Leaf)) { throw "Barlas native build is missing" }
New-Item -ItemType Directory -Force -Path $DataDir, $LogDir | Out-Null

if (Test-Path -LiteralPath $PidFile -PathType Leaf) {
    $ExistingPid = [int]([IO.File]::ReadAllText($PidFile).Trim())
    $Existing = Get-CimInstance Win32_Process -Filter "ProcessId = $ExistingPid" -ErrorAction SilentlyContinue
    if ($Existing -and $Existing.CommandLine -like "*dist*src*native.js*") {
        if (-not $WaitReady) { Write-Host "Barlas is already running (PID $ExistingPid)." }
        return
    }
    Remove-Item -LiteralPath $PidFile -Force
}

$Arguments = "--env-file=`"$EnvFile`" `"$EntryPoint`""
$Process = Start-Process -FilePath $NodeExe -ArgumentList $Arguments -WorkingDirectory $RootDir -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $LogDir "native.out.log") -RedirectStandardError (Join-Path $LogDir "native.error.log")
[IO.File]::WriteAllText($PidFile, [string]$Process.Id, [Text.Encoding]::ASCII)

if ($WaitReady) {
    $Port = Read-Setting "PORT"
    if (-not $Port) { $Port = "17840" }
    $Ready = $false
    for ($Attempt = 0; $Attempt -lt 90; $Attempt++) {
        Start-Sleep -Seconds 2
        if ($Process.HasExited) { break }
        try {
            $Response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/ready" -TimeoutSec 2
            if ($Response.StatusCode -eq 200) { $Ready = $true; break }
        } catch { }
    }
    if (-not $Ready) {
        $Tail = if (Test-Path (Join-Path $LogDir "native.error.log")) { Get-Content (Join-Path $LogDir "native.error.log") -Tail 20 } else { @() }
        if ($Tail) { $Tail | Write-Host }
        throw "Barlas did not become ready. Log: $LogDir\native.error.log"
    }
    Write-Host "[OK] Barlas native runtime is ready" -ForegroundColor Green
}
