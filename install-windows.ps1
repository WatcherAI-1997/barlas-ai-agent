$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

if ($env:OS -ne "Windows_NT") { throw "This bootstrap is for Windows 10/11. Use install.sh on Linux." }

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$NodeVersion = "24.18.0"
$ArchiveUrl = "https://github.com/WatcherAI-1997/barlas-ai-agent/archive/refs/heads/main.zip"
$BarlasHome = Join-Path $env:LOCALAPPDATA "Barlas"
$AppDir = Join-Path $BarlasHome "app"
$BinDir = Join-Path $BarlasHome "bin"
$RuntimeDir = Join-Path $BarlasHome "runtime"
$LogDir = Join-Path $BarlasHome "logs"
$InstallLog = Join-Path $LogDir "install.log"
$NodeDir = Join-Path $RuntimeDir "node"
$NodeExe = Join-Path $NodeDir "node.exe"
$NpmCmd = Join-Path $NodeDir "npm.cmd"
$WorkDir = Join-Path ([IO.Path]::GetTempPath()) ("barlas-install-" + [Guid]::NewGuid().ToString("N"))
$Archive = Join-Path $WorkDir "barlas.zip"
$Extracted = Join-Path $WorkDir "source"
$PreviousDir = Join-Path $BarlasHome "previous"

function Write-Step([int]$Number, [string]$Message) { Write-Host "[$Number/5] $Message" -ForegroundColor Cyan }
function Write-Done([string]$Message) { Write-Host "[OK] $Message" -ForegroundColor Green }

function Invoke-NativeCommand([string]$FilePath, [string[]]$Arguments, [string]$FailureMessage) {
    $PreviousPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $Output = & $FilePath @Arguments 2>&1 | Out-String
        $Code = $LASTEXITCODE
        if ($Output) { [IO.File]::AppendAllText($InstallLog, $Output + [Environment]::NewLine, [Text.Encoding]::UTF8) }
    }
    finally { $ErrorActionPreference = $PreviousPreference }
    if ($Code -ne 0) { throw "$FailureMessage. Details: $InstallLog" }
}

function Show-PixelBanner {
    Write-Host ""
    Write-Host "  ●   ●  " -ForegroundColor Red -NoNewline
    Write-Host "BARLAS" -ForegroundColor White
    Write-Host "    ●    " -ForegroundColor Red -NoNewline
    Write-Host "AI AGENT" -ForegroundColor DarkGray
    Write-Host ""
}

Show-PixelBanner
Write-Host "Native Windows installer - no Docker or WSL required" -ForegroundColor DarkGray
Write-Host ""

New-Item -ItemType Directory -Force -Path $WorkDir, $Extracted, $BarlasHome, $BinDir, $RuntimeDir, $LogDir | Out-Null
[IO.File]::WriteAllText($InstallLog, "Barlas Windows installation log`r`n", [Text.Encoding]::UTF8)
try {
    if (-not (Test-Path -LiteralPath $NodeExe -PathType Leaf)) {
        $Architecture = switch ($env:PROCESSOR_ARCHITECTURE) {
            "AMD64" { "x64" }
            "ARM64" { "arm64" }
            default { throw "Unsupported Windows architecture: $env:PROCESSOR_ARCHITECTURE" }
        }
        $NodeArchive = Join-Path $WorkDir "node.zip"
        $NodeExtract = Join-Path $WorkDir "node"
        $NodeUrl = "https://nodejs.org/dist/v$NodeVersion/node-v$NodeVersion-win-$Architecture.zip"
        Write-Step 1 "Preparing runtime"
        Invoke-WebRequest -UseBasicParsing -Uri $NodeUrl -OutFile $NodeArchive
        Expand-Archive -LiteralPath $NodeArchive -DestinationPath $NodeExtract -Force
        $ExtractedNode = Get-ChildItem -LiteralPath $NodeExtract -Directory | Select-Object -First 1
        if (-not $ExtractedNode -or -not (Test-Path (Join-Path $ExtractedNode.FullName "node.exe"))) { throw "Downloaded Node.js archive is incomplete" }
        if (Test-Path -LiteralPath $NodeDir) { Remove-Item -LiteralPath $NodeDir -Recurse -Force }
        Move-Item -LiteralPath $ExtractedNode.FullName -Destination $NodeDir
        Write-Done "Runtime ready"
    } else { Write-Step 1 "Runtime already ready" }

    Write-Step 2 "Downloading Barlas"
    Invoke-WebRequest -UseBasicParsing -Uri $ArchiveUrl -OutFile $Archive
    Expand-Archive -LiteralPath $Archive -DestinationPath $Extracted -Force
    $SourceDir = Get-ChildItem -LiteralPath $Extracted -Directory | Select-Object -First 1
    if (-not $SourceDir -or -not (Test-Path -LiteralPath (Join-Path $SourceDir.FullName "install-native.ps1") -PathType Leaf)) { throw "Downloaded archive is incomplete" }
    Write-Done "Barlas downloaded"

    $ExistingEnv = Join-Path $AppDir "deploy\native.env"
    if (Test-Path -LiteralPath $ExistingEnv -PathType Leaf) {
        $TargetDeploy = Join-Path $SourceDir.FullName "deploy"
        New-Item -ItemType Directory -Force -Path $TargetDeploy | Out-Null
        Copy-Item -LiteralPath $ExistingEnv -Destination (Join-Path $TargetDeploy "native.env")
    }
    $OldStop = Join-Path $AppDir "scripts\stop-native.ps1"
    if (Test-Path -LiteralPath $OldStop -PathType Leaf) { & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $OldStop }
    if (Test-Path -LiteralPath $PreviousDir) { Remove-Item -LiteralPath $PreviousDir -Recurse -Force }
    if (Test-Path -LiteralPath $AppDir) { Move-Item -LiteralPath $AppDir -Destination $PreviousDir }
    Move-Item -LiteralPath $SourceDir.FullName -Destination $AppDir

    try {
        Write-Step 3 "Building application (this may take a few minutes)"
        Push-Location $AppDir
        try {
            Invoke-NativeCommand $NpmCmd @("ci", "--no-fund", "--no-audit") "Dependency installation failed"
            Invoke-NativeCommand $NpmCmd @("run", "build") "Barlas build failed"
        } finally { Pop-Location }
        Write-Done "Application ready"

        Write-Step 4 "Preparing browser"
        $Playwright = Join-Path $AppDir "node_modules\.bin\playwright-core.cmd"
        Push-Location $AppDir
        try { Invoke-NativeCommand $Playwright @("install", "chromium") "Browser installation failed" }
        finally { Pop-Location }
        Write-Done "Browser ready"

        Write-Step 5 "Personal setup"
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $AppDir "install-native.ps1")
        if ($LASTEXITCODE -ne 0) { throw "Barlas setup exited with code $LASTEXITCODE" }
    } catch {
        if (Test-Path -LiteralPath $PreviousDir) {
            if (Test-Path -LiteralPath $AppDir) { Remove-Item -LiteralPath $AppDir -Recurse -Force }
            Move-Item -LiteralPath $PreviousDir -Destination $AppDir
            $RestoredStart = Join-Path $AppDir "scripts\start-native.ps1"
            if (Test-Path -LiteralPath $RestoredStart -PathType Leaf) {
                & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $RestoredStart
            }
        }
        throw
    }

    $Launcher = Join-Path $BinDir "barlas.cmd"
    $LauncherText = "@echo off`r`npowershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$AppDir\barlas.ps1`" %*`r`n"
    [IO.File]::WriteAllText($Launcher, $LauncherText, [Text.Encoding]::ASCII)
    $UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $PathParts = @($UserPath -split ';' | Where-Object { $_ })
    if ($PathParts -notcontains $BinDir) { [Environment]::SetEnvironmentVariable("Path", ((@($PathParts) + $BinDir) -join ';'), "User") }
    if (($env:Path -split ';') -notcontains $BinDir) { $env:Path = "$env:Path;$BinDir" }
    Write-Done "Global 'barlas' command installed"

    $DashboardUrl = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $AppDir "scripts\dashboard-url.ps1")
    if ($LASTEXITCODE -eq 0 -and $DashboardUrl) { Start-Process ([string]$DashboardUrl).Trim() }
    Write-Host ""
    Write-Host "Barlas is ready - Docker is not used." -ForegroundColor Green
    Write-Host ""
    Write-Host "AI AGENT COMMANDS" -ForegroundColor White
    Write-Host "  barlas" -ForegroundColor Cyan -NoNewline
    Write-Host "                         open interactive AI chat"
    Write-Host '  barlas ask "your task"' -ForegroundColor Cyan -NoNewline
    Write-Host "         run an autonomous task"
    Write-Host "  barlas status" -ForegroundColor Cyan -NoNewline
    Write-Host "                  agent status"
    Write-Host "  barlas runs" -ForegroundColor Cyan -NoNewline
    Write-Host "                    recent runs"
    Write-Host "  barlas approvals" -ForegroundColor Cyan -NoNewline
    Write-Host "               pending approvals"
    Write-Host "  barlas approve ID" -ForegroundColor Cyan -NoNewline
    Write-Host "              approve an action"
    Write-Host "  barlas help" -ForegroundColor Cyan -NoNewline
    Write-Host "                    all commands"
    Write-Host "  barlas update" -ForegroundColor Cyan -NoNewline
    Write-Host "                  update Barlas"
    Write-Host ""
    Write-Host "Start now: barlas" -ForegroundColor Green
    if (Test-Path -LiteralPath $PreviousDir) { Write-Host "Previous application source is preserved at: $PreviousDir" -ForegroundColor DarkGray }
} catch {
    Write-Host ""
    Write-Host "Installation stopped: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Nothing outside $BarlasHome was changed." -ForegroundColor DarkGray
    Write-Host "Log: $InstallLog" -ForegroundColor DarkGray
} finally {
    if (Test-Path -LiteralPath $WorkDir) { Remove-Item -LiteralPath $WorkDir -Recurse -Force }
}
