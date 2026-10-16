[CmdletBinding()]
param([switch]$PurgeData, [switch]$Yes)

$ErrorActionPreference = "Stop"
$RootDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$BarlasHome = Join-Path $env:LOCALAPPDATA "Barlas"
$AppDir = Join-Path $BarlasHome "app"
$DataDir = Join-Path $BarlasHome "data"
$BackupEnv = Join-Path $DataDir "uninstalled-native.env"
$StartupFile = Join-Path ([Environment]::GetFolderPath("Startup")) "Barlas AI Agent.cmd"
$BinDir = Join-Path $BarlasHome "bin"

function Protect-File([string]$Path) {
    $UserSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $PreviousPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        & icacls.exe $Path "/inheritance:r" "/grant:r" "*${UserSid}:(F)" "*S-1-5-18:(F)" *> $null
        $AclExitCode = $LASTEXITCODE
    } finally { $ErrorActionPreference = $PreviousPreference }
    if ($AclExitCode -ne 0) { throw "Unable to protect the Barlas configuration file for the current Windows user." }
}

Write-Host "Barlas will remove its application, private runtime, launcher, logs, and autostart entry." -ForegroundColor Yellow
if ($PurgeData) { Write-Host "All Barlas data and workspaces will also be permanently removed." -ForegroundColor Red }
else { Write-Host "Database, workspaces, and a protected configuration backup will be preserved in $DataDir" }
if (-not $Yes) {
    $Answer = Read-Host "Type UNINSTALL to continue"
    if ($Answer -cne "UNINSTALL") { Write-Host "Uninstall cancelled."; return }
}

$StopScript = Join-Path $AppDir "scripts\stop-native.ps1"
if (Test-Path -LiteralPath $StopScript -PathType Leaf) { & $StopScript }
if (-not $PurgeData) {
    New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
    $EnvironmentFile = Join-Path $AppDir "deploy\native.env"
    if (Test-Path -LiteralPath $EnvironmentFile -PathType Leaf) {
        Copy-Item -LiteralPath $EnvironmentFile -Destination $BackupEnv -Force
        Protect-File $BackupEnv
    }
}
Remove-Item -LiteralPath $StartupFile -Force -ErrorAction SilentlyContinue
$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
$CleanPath = (($UserPath -split ';' | Where-Object { $_ -and $_ -ne $BinDir }) -join ';')
[Environment]::SetEnvironmentVariable("Path", $CleanPath, "User")
foreach ($Target in @($AppDir, (Join-Path $BarlasHome "previous"), (Join-Path $BarlasHome "runtime"), $BinDir, (Join-Path $BarlasHome "logs"))) {
    if (Test-Path -LiteralPath $Target) { Remove-Item -LiteralPath $Target -Recurse -Force }
}
if ($PurgeData -and (Test-Path -LiteralPath $DataDir)) { Remove-Item -LiteralPath $DataDir -Recurse -Force }
Write-Host "[OK] Barlas uninstalled." -ForegroundColor Green
if (-not $PurgeData) { Write-Host "Preserved data: $DataDir" }
