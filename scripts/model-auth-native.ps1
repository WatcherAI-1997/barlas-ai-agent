[CmdletBinding()]
param(
    [ValidateSet("login", "status", "logout")][string]$Action = "status",
    [switch]$Quiet
)

$ErrorActionPreference = "Stop"
$RootDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$BarlasHome = Join-Path $env:LOCALAPPDATA "Barlas"
$NodeExe = Join-Path $BarlasHome "runtime\node\node.exe"
$CliScript = Join-Path $RootDir "node_modules\@openai\codex\bin\codex.js"

if (-not (Test-Path -LiteralPath $NodeExe -PathType Leaf)) { throw "Barlas runtime is missing. Run the installer again." }
if (-not (Test-Path -LiteralPath $CliScript -PathType Leaf)) { throw "The bundled OpenAI sign-in component is missing. Run 'barlas repair'." }

function Invoke-Codex([string[]]$Arguments, [switch]$Capture) {
    # Windows PowerShell converts native stderr (including the harmless
    # "Not logged in" status) into NativeCommandError records. Never let that
    # abort onboarding before it has a chance to open the browser login.
    $PreviousPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        if ($Capture) { $Output = & $NodeExe $CliScript @Arguments 2>&1 | Out-String }
        else {
            & $NodeExe $CliScript @Arguments 2>&1 | ForEach-Object { Write-Host ([string]$_) }
            $Output = ""
        }
        return [pscustomobject]@{ Code = [int]$LASTEXITCODE; Output = ([string]$Output).Trim() }
    } finally { $ErrorActionPreference = $PreviousPreference }
}

if ($Action -eq "login") {
    Write-Host "Opening secure OpenAI account sign-in in your browser..." -ForegroundColor Cyan
    $Login = Invoke-Codex @("login")
    if ($Login.Code -ne 0) { throw "OpenAI account sign-in did not complete." }
    $Status = Invoke-Codex @("login", "status") -Capture
    if ($Status.Code -ne 0) { throw "OpenAI account session could not be verified." }
    Write-Host "[OK] OpenAI account connected. Barlas does not copy or display its OAuth tokens." -ForegroundColor Green
    return
}

if ($Action -eq "logout") {
    $Logout = Invoke-Codex @("logout") -Capture
    if ($Logout.Code -ne 0) { throw "OpenAI account sign-out failed." }
    Write-Host "[OK] OpenAI account disconnected." -ForegroundColor Green
    return
}

$Status = Invoke-Codex @("login", "status") -Capture
if ($Status.Code -eq 0) {
    if ($Quiet) { Write-Output "connected" } else { Write-Host "OpenAI account: connected" -ForegroundColor Green }
} else {
    if ($Quiet) { Write-Output "disconnected" } else { Write-Host "OpenAI account: not connected" -ForegroundColor Yellow }
}
