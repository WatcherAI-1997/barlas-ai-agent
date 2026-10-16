[CmdletBinding()]
param([ValidateSet("login", "status", "logout")][string]$Action = "status")

$ErrorActionPreference = "Stop"
$RootDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$BarlasHome = Join-Path $env:LOCALAPPDATA "Barlas"
$NodeExe = Join-Path $BarlasHome "runtime\node\node.exe"
$CliScript = Join-Path $RootDir "node_modules\@openai\codex\bin\codex.js"

if (-not (Test-Path -LiteralPath $NodeExe -PathType Leaf)) { throw "Barlas runtime is missing. Run the installer again." }
if (-not (Test-Path -LiteralPath $CliScript -PathType Leaf)) { throw "The bundled OpenAI sign-in component is missing. Run 'barlas repair'." }

if ($Action -eq "login") {
    Write-Host "Opening secure OpenAI account sign-in in your browser..." -ForegroundColor Cyan
    & $NodeExe $CliScript login
    if ($LASTEXITCODE -ne 0) { throw "OpenAI account sign-in did not complete." }
    & $NodeExe $CliScript login status
    if ($LASTEXITCODE -ne 0) { throw "OpenAI account session could not be verified." }
    Write-Host "[OK] OpenAI account connected. Barlas does not copy or display its OAuth tokens." -ForegroundColor Green
    exit 0
}

if ($Action -eq "logout") {
    & $NodeExe $CliScript logout
    if ($LASTEXITCODE -ne 0) { throw "OpenAI account sign-out failed." }
    Write-Host "[OK] OpenAI account disconnected." -ForegroundColor Green
    exit 0
}

& $NodeExe $CliScript login status
exit $LASTEXITCODE
