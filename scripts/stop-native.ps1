[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$BarlasHome = Join-Path $env:LOCALAPPDATA "Barlas"
$PidFile = Join-Path $BarlasHome "data\barlas.pid"
if (-not (Test-Path -LiteralPath $PidFile -PathType Leaf)) { exit 0 }
$NativePid = [int]([IO.File]::ReadAllText($PidFile).Trim())
$Process = Get-CimInstance Win32_Process -Filter "ProcessId = $NativePid" -ErrorAction SilentlyContinue
if ($Process -and $Process.CommandLine -like "*dist*src*native.js*") {
    Stop-Process -Id $NativePid -Force -ErrorAction SilentlyContinue
}
Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
