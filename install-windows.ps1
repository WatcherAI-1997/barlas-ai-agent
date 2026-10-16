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

function Find-DockerDesktop {
    $Candidates = @(
        $(if ($env:ProgramFiles) { Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe" }),
        $(if (${env:ProgramFiles(x86)}) { Join-Path ${env:ProgramFiles(x86)} "Docker\Docker\Docker Desktop.exe" }),
        $(if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA "Docker\Docker Desktop.exe" }),
        $(if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA "Programs\Docker\Docker\Docker Desktop.exe" })
    ) | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) }
    if ($Candidates) { return [string]($Candidates | Select-Object -First 1) }

    foreach ($RegistryPath in @(
        "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*",
        "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*",
        "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*"
    )) {
        $Entry = Get-ItemProperty $RegistryPath -ErrorAction SilentlyContinue |
            Where-Object { $_.DisplayName -like "Docker Desktop*" -and $_.DisplayIcon } |
            Select-Object -First 1
        if ($Entry) {
            $DisplayIcon = [string]$Entry.DisplayIcon
            if ($DisplayIcon -match '^"([^"]+)"') { $Executable = $Matches[1] }
            else { $Executable = ($DisplayIcon -split ',', 2)[0].Trim('"') }
            if (Test-Path -LiteralPath $Executable -PathType Leaf) { return $Executable }
        }
    }
    return ""
}

function Start-DockerDesktop {
    $Executable = Find-DockerDesktop
    if ($Executable) {
        Start-Process -FilePath $Executable | Out-Null
        return $true
    }
    $StartApp = Get-Command Get-StartApps -ErrorAction SilentlyContinue
    if ($StartApp) {
        $DockerApp = Get-StartApps | Where-Object { $_.Name -like "Docker Desktop*" } | Select-Object -First 1
        if ($DockerApp) {
            Start-Process explorer.exe "shell:AppsFolder\$($DockerApp.AppID)" | Out-Null
            return $true
        }
    }
    try {
        Start-Process "docker-desktop:" | Out-Null
        return $true
    } catch {
        return $false
    }
}

function Show-PixelBanner {
    $Font = @{
        B = @("11110", "10001", "11110", "10001", "11110")
        A = @("01110", "10001", "11111", "10001", "10001")
        R = @("11110", "10001", "11110", "10100", "10010")
        L = @("10000", "10000", "10000", "10000", "11111")
        S = @("01111", "10000", "01110", "00001", "11110")
    }
    $Mark = @("  ▄████▄    ▄████▄  ", " ████████  ████████ ", "  ▀████▀    ▀████▀  ", "      ▄████▄        ", "     ████████       ", "      ▀████▀        ")
    Write-Host ""
    for ($Row = 0; $Row -lt 6; $Row++) {
        Write-Host ($Mark[$Row] + "   ") -ForegroundColor Red -NoNewline
        if ($Row -lt 5) {
            $Letters = foreach ($Letter in "BARLAS".ToCharArray()) {
                -join ($Font[[string]$Letter][$Row].ToCharArray() | ForEach-Object { if ($_ -eq '1') { "██" } else { "  " } })
            }
            Write-Host ($Letters -join "  ") -ForegroundColor White
        } else {
            Write-Host "A I   A G E N T" -ForegroundColor DarkGray
        }
    }
    Write-Host ""
}

Show-PixelBanner
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
    Write-Host "Install and start Docker Desktop, then run the Barlas command again." -ForegroundColor Red
    return
}

& cmd.exe /d /c "docker info >nul 2>nul"
if ($LASTEXITCODE -ne 0) {
    if (Start-DockerDesktop) {
        Write-Step "Start Docker Desktop"
        $DockerReady = $false
        for ($Attempt = 0; $Attempt -lt 60; $Attempt++) {
            Start-Sleep -Seconds 3
            & cmd.exe /d /c "docker info >nul 2>nul"
            if ($LASTEXITCODE -eq 0) { $DockerReady = $true; break }
        }
        if ($DockerReady) { Write-Done "Docker Desktop is ready" }
        else {
            Write-Host "Docker Desktop did not become ready within three minutes." -ForegroundColor Red
            Write-Host "Open Docker Desktop, finish any WSL 2 setup it requests, then run this command again."
            return
        }
    } else {
        Write-Host "Docker Desktop is installed, but its Linux engine is not running." -ForegroundColor Red
        Write-Host "Open Docker Desktop from the Start menu, wait until it says Engine running, then run this command again."
        return
    }
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
        $env:BARLAS_BOOTSTRAP_ACTIVE = "1"
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
