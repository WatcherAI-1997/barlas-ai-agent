[CmdletBinding()]
param([string]$EnvFile)

$ErrorActionPreference = "Stop"
$RootDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
if ([string]::IsNullOrWhiteSpace($EnvFile)) { $EnvFile = Join-Path $RootDir "deploy\local.env" }
elseif (-not [IO.Path]::IsPathRooted($EnvFile)) { $EnvFile = Join-Path $RootDir $EnvFile }
$EnvFile = [IO.Path]::GetFullPath($EnvFile)
if (-not (Test-Path -LiteralPath $EnvFile -PathType Leaf)) { throw "Protected environment file not found" }

function Read-Setting([string]$Name) {
    $Prefix = "$Name="
    foreach ($Line in [IO.File]::ReadAllLines($EnvFile)) {
        if ($Line.StartsWith($Prefix, [StringComparison]::Ordinal)) {
            $Value = $Line.Substring($Prefix.Length)
            if ($Value.Length -ge 2 -and $Value[0] -eq "'" -and $Value[$Value.Length - 1] -eq "'") { return $Value.Substring(1, $Value.Length - 2).Replace("\'", "'") }
            return $Value.Trim('"')
        }
    }
    return ""
}

$Mode = Read-Setting "BARLAS_INSTALL_MODE"
$Port = Read-Setting "BARLAS_HTTP_PORT"
$Token = Read-Setting "BARLAS_GATEWAY_TOKEN"
if ($Mode -ne "local" -or -not $Port -or $Token.Length -lt 32) { throw "Local gateway access configuration is incomplete" }
Write-Output "http://127.0.0.1:$Port/#token=$Token"
