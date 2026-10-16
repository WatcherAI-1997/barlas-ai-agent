[CmdletBinding()]
param(
    [string]$EnvFile,
    [switch]$RequireRunning
)

$ErrorActionPreference = "Continue"
$RootDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Failures = 0
$Warnings = 0

function Pass([string]$Message) { Write-Host "[OK] $Message" -ForegroundColor Green }
function Fail([string]$Message) { Write-Host "[FAIL] $Message" -ForegroundColor Red; $script:Failures++ }
function Warn([string]$Message) { Write-Host "[WARN] $Message" -ForegroundColor Yellow; $script:Warnings++ }
function Read-Setting([string]$Path, [string]$Name) {
    $Prefix = "$Name="
    foreach ($Line in [IO.File]::ReadAllLines($Path)) {
        if ($Line.StartsWith($Prefix, [StringComparison]::Ordinal)) {
            $Value = $Line.Substring($Prefix.Length)
            if ($Value.Length -ge 2 -and $Value[0] -eq "'" -and $Value[$Value.Length - 1] -eq "'") { return $Value.Substring(1, $Value.Length - 2).Replace("\'", "'") }
            return $Value.Trim('"')
        }
    }
    return ""
}

if ([string]::IsNullOrWhiteSpace($EnvFile)) { $EnvFile = Join-Path $RootDir "deploy\local.env" }
elseif (-not [IO.Path]::IsPathRooted($EnvFile)) { $EnvFile = Join-Path $RootDir $EnvFile }
$EnvFile = [IO.Path]::GetFullPath($EnvFile)

if (Get-Command docker -ErrorAction SilentlyContinue) { Pass "Docker is available" } else { Fail "Docker Desktop is missing" }
& docker compose version *> $null
if ($LASTEXITCODE -eq 0) { Pass "Docker Compose v2 is available" } else { Fail "Docker Compose v2 is unavailable" }

if (-not (Test-Path -LiteralPath $EnvFile -PathType Leaf)) {
    Fail "Protected environment file is missing: $EnvFile"
} else {
    $Text = [IO.File]::ReadAllText($EnvFile)
    if ($Text -match 'replace-with-|agent\.example\.com|owner@example\.com') { Fail "Environment contains placeholders" } else { Pass "Environment has no template placeholders" }
    if ((Read-Setting $EnvFile "BARLAS_INSTALL_MODE") -eq "local") { Pass "Environment is configured for local mode" } else { Fail "Environment is not configured for local mode" }
}

$env:BARLAS_ENV_FILE = $EnvFile
$ComposeArgs = @("compose", "-f", (Join-Path $RootDir "compose.production.yml"), "-f", (Join-Path $RootDir "compose.local.yml"), "--env-file", $EnvFile)
if ($Failures -eq 0) {
    & docker @ComposeArgs config --quiet *> $null
    if ($LASTEXITCODE -eq 0) { Pass "Compose configuration is valid" } else { Fail "Compose configuration is invalid" }
}

& docker info *> $null
if ($LASTEXITCODE -ne 0) {
    if ($RequireRunning) { Fail "Docker Desktop engine is unavailable" } else { Warn "Docker Desktop engine is unavailable; runtime checks skipped" }
} elseif ($Failures -eq 0) {
    $ApiId = (& docker @ComposeArgs ps -q api 2>$null | Select-Object -First 1)
    if (-not $ApiId) {
        if ($RequireRunning) { Fail "API container is not running" } else { Warn "Stack is not running; configuration-only checks passed" }
    } else {
        $Health = (& docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' $ApiId 2>$null).Trim()
        if ($Health -eq "healthy") { Pass "API container is healthy" } else { Fail "API container health is $Health" }
        & docker exec $ApiId wget -q -O - http://127.0.0.1:17840/ready *> $null
        if ($LASTEXITCODE -eq 0) { Pass "API /ready responds inside its container" } else { Fail "API /ready check failed" }
        foreach ($Service in @("database", "browser", "sandbox")) {
            $Id = (& docker @ComposeArgs ps -q $Service 2>$null | Select-Object -First 1)
            if (-not $Id) { Fail "$Service container is not running"; continue }
            $State = (& docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' $Id 2>$null).Trim()
            if ($State -in @("healthy", "running")) { Pass "$Service container is $State" } else { Fail "$Service container state is $State" }
        }
    }
}

Write-Host ""
Write-Host "Doctor result: $Failures failure(s), $Warnings warning(s)."
if ($Failures -gt 0) { exit 1 }
exit 0
