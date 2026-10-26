[CmdletBinding()]
param(
    [switch]$SkipInstall,
    [string]$OutputDirectory = ""
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $Root "artifacts" }
$Npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
if (-not $Npm) { throw "npm.cmd is required to run the Windows release gate." }

function Invoke-NpmStep([string[]]$Arguments, [string]$Label) {
    Write-Host "`n== $Label ==" -ForegroundColor Cyan
    & $Npm @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Label failed with exit code $LASTEXITCODE" }
}

Push-Location $Root
try {
    if (-not $SkipInstall) { Invoke-NpmStep @("ci") "Clean dependency install" }
    Invoke-NpmStep @("test") "Automated tests"
    Invoke-NpmStep @("run", "typecheck") "TypeScript typecheck"
    Invoke-NpmStep @("run", "build") "Production build"
    Invoke-NpmStep @("run", "check:security") "Security baseline"
    Invoke-NpmStep @("run", "check:isolation") "Isolation boundary"
    Invoke-NpmStep @("audit", "--audit-level=low") "Dependency audit"
    Invoke-NpmStep @("run", "test:native-release") "Native restart and persistence smoke"

    Write-Host "`n== Windows installer ==" -ForegroundColor Cyan
    & (Join-Path $Root "scripts\build-windows-installer.ps1") -OutputDirectory $OutputDirectory
    if ($LASTEXITCODE -ne 0) { throw "Windows installer build failed with exit code $LASTEXITCODE" }

    Write-Host "`n[OK] Barlas Windows release gate passed." -ForegroundColor Green
    Write-Host "Unsigned review artifacts: $OutputDirectory" -ForegroundColor DarkGray
}
finally {
    Pop-Location
}
