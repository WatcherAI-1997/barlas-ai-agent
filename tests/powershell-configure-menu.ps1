$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Configure = [IO.File]::ReadAllText((Join-Path $Root "scripts\configure-native.ps1"))
$Cut = $Configure.IndexOf('if (-not (Test-Path -LiteralPath $EnvFile', [StringComparison]::Ordinal)
if ($Cut -lt 0) { throw "Unable to isolate onboarding menu functions" }
Invoke-Expression $Configure.Substring(0, $Cut)

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
    $script:Answers.Enqueue("")
    $Selected = Read-MappedChoice "Provider" @("openai", "anthropic", "ollama") @("OpenAI", "Anthropic", "Ollama") "retired-provider"
    Assert-Equal "openai" $Selected "invalid existing default"

    $script:Answers.Enqueue("999999999999999999999999999")
    $script:Answers.Enqueue("2")
    $Selected = Read-MappedChoice "Provider" @("openai", "anthropic", "ollama") @("OpenAI", "Anthropic", "Ollama") "openai"
    Assert-Equal "anthropic" $Selected "large numeric input retry"

    Write-Output "OK onboarding menu behavior"
}
finally {
    Remove-Item Function:\global:Read-Host -ErrorAction SilentlyContinue
}
