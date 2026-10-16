[CmdletBinding()]
param([ValidateSet("check", "update", "rollback", "repair")][string]$Action = "update")

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$RootDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$BarlasHome = Join-Path $env:LOCALAPPDATA "Barlas"
$AppDir = Join-Path $BarlasHome "app"
$PreviousDir = Join-Path $BarlasHome "previous"
$SwapDir = Join-Path $BarlasHome "rollback-swap"
$VersionFile = Join-Path $AppDir ".barlas-version"
$ReleaseApiUrl = "https://api.github.com/repos/WatcherAI-1997/barlas-ai-agent/commits/main"
$BootstrapUrl = "https://raw.githubusercontent.com/WatcherAI-1997/barlas-ai-agent/main/install-windows.ps1"

function Protect-File([string]$Path) {
    $Identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    $Acl = New-Object Security.AccessControl.FileSecurity
    $Acl.SetAccessRuleProtection($true, $false)
    $Acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($Identity, [Security.AccessControl.FileSystemRights]::FullControl, [Security.AccessControl.AccessControlType]::Allow))
    $Acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new("NT AUTHORITY\SYSTEM", [Security.AccessControl.FileSystemRights]::FullControl, [Security.AccessControl.AccessControlType]::Allow))
    Set-Acl -LiteralPath $Path -AclObject $Acl
}
function Current-Version {
    if (-not (Test-Path -LiteralPath $VersionFile -PathType Leaf)) { return "unknown" }
    $Version = [IO.File]::ReadAllText($VersionFile).Trim()
    if ($Version -notmatch '^[a-f0-9]{40}$') { return "unknown" }
    return $Version
}
function Latest-Version {
    $Release = Invoke-RestMethod -UseBasicParsing -Uri $ReleaseApiUrl
    $Version = [string]$Release.sha
    if ($Version -notmatch '^[a-f0-9]{40}$') { throw "GitHub returned an invalid release identifier" }
    return $Version
}
function Run-Bootstrap {
    $Temporary = Join-Path ([IO.Path]::GetTempPath()) ("barlas-bootstrap-" + [Guid]::NewGuid().ToString("N") + ".ps1")
    try {
        Invoke-WebRequest -UseBasicParsing -Uri $BootstrapUrl -OutFile $Temporary
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $Temporary
        if ($LASTEXITCODE -ne 0) { throw "Barlas bootstrap failed" }
    } finally { Remove-Item -LiteralPath $Temporary -Force -ErrorAction SilentlyContinue }
}

if ($Action -in @("check", "update")) {
    $Current = Current-Version
    $Latest = Latest-Version
    Write-Host "Current:  $Current"
    Write-Host "Latest:   $Latest"
    if ($Current -eq $Latest) { Write-Host "Barlas is up to date." -ForegroundColor Green; return }
    Write-Host "Update available." -ForegroundColor Yellow
    if ($Action -eq "check") { return }
    Run-Bootstrap
    return
}
if ($Action -eq "repair") {
    Write-Host "Repairing Barlas from the latest public release..." -ForegroundColor Cyan
    Run-Bootstrap
    return
}

if (-not (Test-Path -LiteralPath $PreviousDir -PathType Container)) { throw "No previous Barlas version is available" }
if (Test-Path -LiteralPath $SwapDir) { throw "Rollback recovery directory already exists: $SwapDir" }
$PreviousVersionFile = Join-Path $PreviousDir ".barlas-version"
$PreviousVersion = if (Test-Path -LiteralPath $PreviousVersionFile -PathType Leaf) { [IO.File]::ReadAllText($PreviousVersionFile).Trim() } else { "unknown" }
$CurrentVersion = Current-Version
$CurrentEnv = Join-Path $AppDir "deploy\native.env"
if (-not (Test-Path -LiteralPath $CurrentEnv -PathType Leaf)) { throw "Current protected configuration is missing" }
$Configuration = [IO.File]::ReadAllBytes($CurrentEnv)
Write-Host "Rollback: $CurrentVersion -> $PreviousVersion" -ForegroundColor Yellow
$Answer = Read-Host "Continue? [y/N]"
if ($Answer -notmatch '^[Yy]$') { Write-Host "Rollback cancelled."; return }

& (Join-Path $AppDir "scripts\stop-native.ps1")
Move-Item -LiteralPath $AppDir -Destination $SwapDir
try {
    Move-Item -LiteralPath $PreviousDir -Destination $AppDir
    $RestoredEnv = Join-Path $AppDir "deploy\native.env"
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $RestoredEnv) | Out-Null
    [IO.File]::WriteAllBytes($RestoredEnv, $Configuration)
    Protect-File $RestoredEnv
    & (Join-Path $AppDir "scripts\start-native.ps1") -WaitReady
    Move-Item -LiteralPath $SwapDir -Destination $PreviousDir
    Write-Host "[OK] Rollback complete" -ForegroundColor Green
} catch {
    Write-Host "Rollback failed; restoring the current version." -ForegroundColor Red
    if (Test-Path -LiteralPath $AppDir) { Move-Item -LiteralPath $AppDir -Destination $PreviousDir }
    if (Test-Path -LiteralPath $SwapDir) { Move-Item -LiteralPath $SwapDir -Destination $AppDir }
    & (Join-Path $AppDir "scripts\start-native.ps1") -WaitReady
    throw
}
