[CmdletBinding()]
param(
    [string]$OutputDirectory = "",
    [string]$Makensis = ""
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $Root "artifacts" }
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$OutputDirectory = (Resolve-Path -LiteralPath $OutputDirectory).Path

if (-not $Makensis) {
    $Candidates = @(
        (Join-Path ${env:ProgramFiles(x86)} "NSIS\makensis.exe"),
        (Join-Path $env:ProgramFiles "NSIS\makensis.exe")
    )
    $Makensis = $Candidates | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -First 1
}
if (-not $Makensis -or -not (Test-Path -LiteralPath $Makensis -PathType Leaf)) {
    throw "NSIS 3 is required to build the installer. Install it from https://nsis.sourceforge.io and rerun this command."
}

$Git = (Get-Command git.exe -ErrorAction SilentlyContinue).Source
if (-not $Git) { throw "Git for Windows is required to create a reproducible source archive." }
if (& $Git -C $Root status --porcelain) { throw "Refusing to package a dirty worktree." }

$Temporary = Join-Path ([IO.Path]::GetTempPath()) ("barlas-installer-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $Temporary | Out-Null
try {
    $Archive = Join-Path $Temporary "barlas-source.zip"
    & $Git -C $Root archive --format=zip --prefix=barlas-ai-agent/ --output=$Archive HEAD
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $Archive -PathType Leaf)) { throw "Unable to create the source archive." }

    $Output = Join-Path $OutputDirectory "Barlas-AI-Agent-Setup.exe"
    $Definitions = @(
        "/DSOURCE_ARCHIVE=$Archive",
        "/DBOOTSTRAP_SCRIPT=$(Join-Path $Root 'install-windows.ps1')",
        "/DBRAND_BITMAP=$(Join-Path $Root 'installer\windows\barlas-welcome.bmp')",
        "/DBRAND_ICON=$(Join-Path $Root 'installer\windows\barlas.ico')",
        "/DOUTPUT_FILE=$Output",
        (Join-Path $Root "installer\windows\barlas-agent.nsi")
    )
    & $Makensis @Definitions
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $Output -PathType Leaf)) { throw "NSIS did not produce the installer." }
    $Hash = (Get-FileHash -LiteralPath $Output -Algorithm SHA256).Hash.ToLowerInvariant()
    [IO.File]::WriteAllText("$Output.sha256", "$Hash  $([IO.Path]::GetFileName($Output))`r`n", [Text.Encoding]::ASCII)
    Write-Host "Built: $Output" -ForegroundColor Green
    Write-Host "SHA-256: $Hash" -ForegroundColor DarkGray
}
finally {
    if (Test-Path -LiteralPath $Temporary) { Remove-Item -LiteralPath $Temporary -Recurse -Force }
}
