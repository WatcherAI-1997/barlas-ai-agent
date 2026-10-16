$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

if ($env:OS -ne "Windows_NT") {
    throw "This bootstrap is for Windows 10/11. Use install.sh on Linux."
}

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$ArchiveUrl = "https://github.com/WatcherAI-1997/barlas-ai-agent/archive/refs/heads/main.zip"
$BarlasHome = Join-Path $env:LOCALAPPDATA "Barlas"
$AppDir = Join-Path $BarlasHome "app"
$BinDir = Join-Path $BarlasHome "bin"
$WorkDir = Join-Path ([IO.Path]::GetTempPath()) ("barlas-install-" + [Guid]::NewGuid().ToString("N"))
$Archive = Join-Path $WorkDir "barlas.zip"
$Extracted = Join-Path $WorkDir "source"
$PreviousDir = Join-Path $BarlasHome "previous"

function Write-Step([string]$Message) { Write-Host "-> $Message" -ForegroundColor Cyan }
function Write-Done([string]$Message) { Write-Host "[OK] $Message" -ForegroundColor Green }

Write-Host ""
Write-Host "  O  O   Barlas" -ForegroundColor Red
Write-Host "    O     AI AGENT" -ForegroundColor Red
Write-Host ""
Write-Host "One-command Windows installer" -ForegroundColor DarkGray
Write-Host ""

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Host "Docker Desktop is required and was not found." -ForegroundColor Yellow
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        Write-Host "Install it with this command, start Docker Desktop, then run the Barlas command again:"
        Write-Host "winget install -e --id Docker.DockerDesktop" -ForegroundColor White
    } else {
        Write-Host "Download Docker Desktop from https://www.docker.com/products/docker-desktop/"
    }
    throw "Install and start Docker Desktop, then run the Barlas command again."
}

& docker info *> $null
if ($LASTEXITCODE -ne 0) {
    throw "Docker Desktop is installed but its Linux engine is not running. Start Docker Desktop, wait until it is ready, then run this command again."
}

New-Item -ItemType Directory -Force -Path $WorkDir, $Extracted, $BarlasHome, $BinDir | Out-Null
try {
    Write-Step "Download Barlas from GitHub"
    Invoke-WebRequest -UseBasicParsing -Uri $ArchiveUrl -OutFile $Archive
    Expand-Archive -LiteralPath $Archive -DestinationPath $Extracted -Force
    $SourceDir = Get-ChildItem -LiteralPath $Extracted -Directory | Select-Object -First 1
    if (-not $SourceDir -or -not (Test-Path -LiteralPath (Join-Path $SourceDir.FullName "install.ps1") -PathType Leaf)) {
        throw "Downloaded archive is incomplete"
    }
    Write-Done "Barlas source downloaded"

    $ExistingEnv = Join-Path $AppDir "deploy\local.env"
    if (Test-Path -LiteralPath $ExistingEnv -PathType Leaf) {
        $TargetDeploy = Join-Path $SourceDir.FullName "deploy"
        New-Item -ItemType Directory -Force -Path $TargetDeploy | Out-Null
        Copy-Item -LiteralPath $ExistingEnv -Destination (Join-Path $TargetDeploy "local.env")
    }

    if (Test-Path -LiteralPath $PreviousDir) {
        Remove-Item -LiteralPath $PreviousDir -Recurse -Force
    }
    if (Test-Path -LiteralPath $AppDir) {
        Move-Item -LiteralPath $AppDir -Destination $PreviousDir
    }
    Move-Item -LiteralPath $SourceDir.FullName -Destination $AppDir

    try {
        Write-Step "Run the guided installer"
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $AppDir "install.ps1")
        if ($LASTEXITCODE -ne 0) { throw "Barlas installer exited with code $LASTEXITCODE" }
    } catch {
        if (Test-Path -LiteralPath $PreviousDir) {
            if (Test-Path -LiteralPath $AppDir) { Remove-Item -LiteralPath $AppDir -Recurse -Force }
            Move-Item -LiteralPath $PreviousDir -Destination $AppDir
        }
        throw
    }

    $Launcher = Join-Path $BinDir "barlas.cmd"
    $LauncherText = "@echo off`r`npowershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$AppDir\barlas.ps1`" %*`r`n"
    [IO.File]::WriteAllText($Launcher, $LauncherText, [Text.Encoding]::ASCII)
    $UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $PathParts = @($UserPath -split ';' | Where-Object { $_ })
    if ($PathParts -notcontains $BinDir) {
        $NewPath = (@($PathParts) + $BinDir) -join ';'
        [Environment]::SetEnvironmentVariable("Path", $NewPath, "User")
    }
    if (($env:Path -split ';') -notcontains $BinDir) { $env:Path = "$env:Path;$BinDir" }
    Write-Done "Global 'barlas' command installed"

    $DashboardScript = Join-Path $AppDir "scripts\dashboard-url.ps1"
    $DashboardUrl = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $DashboardScript
    if ($LASTEXITCODE -eq 0 -and $DashboardUrl) {
        Start-Process ([string]$DashboardUrl).Trim()
    }
    Write-Host ""
    Write-Host "Barlas is ready. Future updates use the same one-line install command." -ForegroundColor Green
    Write-Host "Open a new PowerShell window and run: barlas"
    if (Test-Path -LiteralPath $PreviousDir) {
        Write-Host "Previous application source is preserved at: $PreviousDir" -ForegroundColor DarkGray
    }
} finally {
    if (Test-Path -LiteralPath $WorkDir) { Remove-Item -LiteralPath $WorkDir -Recurse -Force }
}
