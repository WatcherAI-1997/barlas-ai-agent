[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$RootDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$BarlasHome = Join-Path $env:LOCALAPPDATA "Barlas"
$NodeExe = Join-Path $BarlasHome "runtime\node\node.exe"
$EntryPoint = Join-Path $RootDir "dist\src\native.js"
$PidFile = Join-Path $BarlasHome "data\barlas.pid"
if (-not (Test-Path -LiteralPath $PidFile -PathType Leaf)) { exit 0 }
$NativePid = 0
$ValidPid = [int]::TryParse([IO.File]::ReadAllText($PidFile).Trim(), [ref]$NativePid) -and $NativePid -gt 0
$Process = if ($ValidPid) { Get-CimInstance Win32_Process -Filter "ProcessId = $NativePid" -ErrorAction SilentlyContinue } else { $null }
$ExpectedNode = [IO.Path]::GetFullPath($NodeExe)
$QuotedEntryPoint = '"' + [IO.Path]::GetFullPath($EntryPoint) + '"'
$MatchesNode = $Process -and $Process.ExecutablePath -and ([IO.Path]::GetFullPath([string]$Process.ExecutablePath)).Equals($ExpectedNode, [StringComparison]::OrdinalIgnoreCase)
$MatchesEntryPoint = $Process -and $Process.CommandLine -and ([string]$Process.CommandLine).IndexOf($QuotedEntryPoint, [StringComparison]::OrdinalIgnoreCase) -ge 0
if ($MatchesNode -and $MatchesEntryPoint) {
    Stop-Process -Id $NativePid -Force -ErrorAction SilentlyContinue
    try { Wait-Process -Id $NativePid -Timeout 10 -ErrorAction SilentlyContinue } catch { }
}
Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
