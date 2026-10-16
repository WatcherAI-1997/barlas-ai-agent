$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Installer = [IO.File]::ReadAllText((Join-Path $Root "install-native.ps1"))
$Cut = $Installer.IndexOf("function New-RandomHex", [StringComparison]::Ordinal)
if ($Cut -lt 0) { throw "Unable to isolate installer menu functions" }
$env:LOCALAPPDATA = Join-Path ([IO.Path]::GetTempPath()) "barlas-menu-test"
Invoke-Expression $Installer.Substring(0, $Cut)

function Assert-Equal([string]$Expected, [string]$Actual, [string]$Label) {
    if ($Expected -ne $Actual) { throw "$Label expected '$Expected' but received '$Actual'" }
}

$script:Answers = [Collections.Generic.Queue[string]]::new()
function global:Read-Host {
    param([string]$Prompt, [switch]$AsSecureString)
    if ($script:Answers.Count -eq 0) { throw "No test answer remains for: $Prompt" }
    $Answer = $script:Answers.Dequeue()
    if ($AsSecureString) { return ConvertTo-SecureString $Answer -AsPlainText -Force }
    return $Answer
}

try {
    $NonInteractive = $false
    $script:Answers.Enqueue("999999999999999999999999999")
    $script:Answers.Enqueue("3")
    $Selected = Read-MenuChoice "" "Provider" @("openai", "anthropic", "ollama") @("OpenAI", "Anthropic", "Ollama") "openai"
    Assert-Equal "ollama" $Selected "large numeric input retry"

    $NonInteractive = $true
    $env:MODEL_PROVIDER = "openai codex"
    $Aliases = @{ "openai codex" = "openai" }
    $Selected = Read-MenuChoice "MODEL_PROVIDER" "Provider" @("openai", "anthropic", "ollama") @("OpenAI", "Anthropic", "Ollama") "openai" $Aliases
    Assert-Equal "openai" $Selected "provider alias"

    $env:MODEL_PROVIDER = "openai-invalid"
    $Rejected = $false
    try {
        Read-MenuChoice "MODEL_PROVIDER" "Provider" @("openai", "anthropic", "ollama") @("OpenAI", "Anthropic", "Ollama") "openai" $Aliases | Out-Null
    } catch { $Rejected = $true }
    if (-not $Rejected) { throw "invalid environment provider was accepted" }

    Write-Output "OK installer menu behavior"
}
finally {
    Remove-Item Env:MODEL_PROVIDER -ErrorAction SilentlyContinue
    Remove-Item Function:\global:Read-Host -ErrorAction SilentlyContinue
}
