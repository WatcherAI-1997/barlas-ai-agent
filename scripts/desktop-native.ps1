[CmdletBinding()]
param(
    [ValidateSet("open", "install", "uninstall", "status")]
    [string]$Action = "open"
)

$ErrorActionPreference = "Stop"
$RootDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$BarlasHome = Join-Path $env:LOCALAPPDATA "Barlas"
$DesktopRoot = Join-Path $BarlasHome "desktop"
$ProfileDir = Join-Path $DesktopRoot "profile"
$IconPath = Join-Path $DesktopRoot "barlas.ico"
$DesktopShortcut = Join-Path ([Environment]::GetFolderPath("Desktop")) "Barlas AI Agent.lnk"
$ProgramsDir = Join-Path ([Environment]::GetFolderPath("Programs")) "Barlas"
$StartMenuShortcut = Join-Path $ProgramsDir "Barlas AI Agent.lnk"
$WindowsPowerShellExe = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
$ScriptPath = $MyInvocation.MyCommand.Path

function Get-EdgePath {
    $Candidates = @()
    foreach ($Location in @(${env:ProgramFiles(x86)}, $env:ProgramFiles, $env:LOCALAPPDATA)) {
        if ($Location) {
            $Candidate = Join-Path $Location "Microsoft\Edge\Application\msedge.exe"
            if (Test-Path -LiteralPath $Candidate -PathType Leaf) { $Candidates += $Candidate }
        }
    }
    if ($Candidates.Count -gt 0) { return [string]$Candidates[0] }
    $Command = Get-Command "msedge.exe" -ErrorAction SilentlyContinue
    if ($Command) { return [string]$Command.Source }
    throw "Microsoft Edge WebView runtime is unavailable. Install or repair Microsoft Edge, then run 'barlas desktop install'."
}

function New-BarlasIcon {
    $Source = Join-Path $RootDir "assets\brand\barlas-ai-agent-logo-original.png"
    if (-not (Test-Path -LiteralPath $Source -PathType Leaf)) { throw "Barlas desktop icon source is missing." }
    New-Item -ItemType Directory -Force -Path $DesktopRoot | Out-Null
    Add-Type -AssemblyName System.Drawing
    if (-not ("BarlasDesktopIcon" -as [type])) {
        Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class BarlasDesktopIcon {
    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    public static extern bool DestroyIcon(IntPtr handle);
}
"@
    }
    $Bitmap = $null
    $Icon = $null
    $Stream = $null
    $Handle = [IntPtr]::Zero
    try {
        $Bitmap = [Drawing.Bitmap]::new($Source)
        $Handle = $Bitmap.GetHicon()
        $Icon = ([Drawing.Icon]::FromHandle($Handle)).Clone()
        $Stream = [IO.File]::Create($IconPath)
        $Icon.Save($Stream)
    } finally {
        if ($Stream) { $Stream.Dispose() }
        if ($Icon) { $Icon.Dispose() }
        if ($Handle -ne [IntPtr]::Zero) { [BarlasDesktopIcon]::DestroyIcon($Handle) | Out-Null }
        if ($Bitmap) { $Bitmap.Dispose() }
    }
}

function New-BarlasShortcut([string]$Path) {
    $Parent = Split-Path -Parent $Path
    New-Item -ItemType Directory -Force -Path $Parent | Out-Null
    $Shell = New-Object -ComObject WScript.Shell
    $Shortcut = $Shell.CreateShortcut($Path)
    $Shortcut.TargetPath = $WindowsPowerShellExe
    $Shortcut.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$ScriptPath`" -Action open"
    $Shortcut.WorkingDirectory = $RootDir
    $Shortcut.Description = "Barlas AI Agent desktop control center"
    $Shortcut.IconLocation = "$IconPath,0"
    $Shortcut.Save()
}

function Install-Desktop {
    Get-EdgePath | Out-Null
    New-BarlasIcon
    New-BarlasShortcut $DesktopShortcut
    New-BarlasShortcut $StartMenuShortcut
    Write-Output "Barlas Desktop installed for the current Windows user."
    Write-Output "Desktop shortcut: $DesktopShortcut"
    Write-Output "Start menu shortcut: $StartMenuShortcut"
}

function Uninstall-Desktop {
    Remove-Item -LiteralPath $DesktopShortcut -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $StartMenuShortcut -Force -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $ProgramsDir) {
        $Remaining = @(Get-ChildItem -LiteralPath $ProgramsDir -Force -ErrorAction SilentlyContinue)
        if ($Remaining.Count -eq 0) { Remove-Item -LiteralPath $ProgramsDir -Force }
    }
    if (Test-Path -LiteralPath $DesktopRoot) { Remove-Item -LiteralPath $DesktopRoot -Recurse -Force }
    Write-Output "Barlas Desktop shortcuts and isolated profile removed."
}

function Open-Desktop {
    $Edge = Get-EdgePath
    $StartScript = Join-Path $RootDir "scripts\start-native.ps1"
    $DashboardScript = Join-Path $RootDir "scripts\dashboard-url.ps1"
    if (-not (Test-Path -LiteralPath $DashboardScript -PathType Leaf)) { throw "Barlas dashboard launcher is missing." }
    $DashboardUrl = ([string](& $DashboardScript)).Trim()
    if (-not $DashboardUrl.StartsWith("http://127.0.0.1:", [StringComparison]::Ordinal)) {
        throw "Barlas Desktop only opens the loopback native gateway."
    }
    $DashboardUri = [Uri]$DashboardUrl
    $ReadyUrl = "http://127.0.0.1:$($DashboardUri.Port)/ready"
    try {
        $Ready = Invoke-WebRequest -UseBasicParsing -Uri $ReadyUrl -TimeoutSec 2
    } catch { $Ready = $null }
    if (-not $Ready -and (Test-Path -LiteralPath $StartScript -PathType Leaf)) { & $StartScript -WaitReady }
    New-Item -ItemType Directory -Force -Path $ProfileDir | Out-Null
    $Arguments = @(
        "--app=`"$DashboardUrl`"",
        "--user-data-dir=`"$ProfileDir`"",
        "--no-first-run",
        "--disable-sync"
    )
    Start-Process -FilePath $Edge -ArgumentList $Arguments | Out-Null
}

if ($Action -eq "install") { Install-Desktop; exit 0 }
if ($Action -eq "uninstall") { Uninstall-Desktop; exit 0 }
if ($Action -eq "status") {
    $Installed = (Test-Path -LiteralPath $DesktopShortcut -PathType Leaf) -and (Test-Path -LiteralPath $StartMenuShortcut -PathType Leaf)
    if ($Installed) { Write-Output "installed"; exit 0 }
    Write-Output "not-installed"
    exit 1
}
Open-Desktop
