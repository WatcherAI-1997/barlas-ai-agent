[CmdletBinding()]
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)

$ErrorActionPreference = "Stop"
$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$EnvFile = Join-Path $RootDir "deploy\local.env"
if (-not (Test-Path -LiteralPath $EnvFile -PathType Leaf)) {
    throw "Barlas is not configured. Run .\install.ps1 first."
}
$env:BARLAS_ENV_FILE = $EnvFile
$ComposeArgs = @("compose", "-f", (Join-Path $RootDir "compose.production.yml"), "-f", (Join-Path $RootDir "compose.local.yml"), "--env-file", $EnvFile)
& docker @ComposeArgs exec api node dist/src/cli.js @Arguments
exit $LASTEXITCODE
