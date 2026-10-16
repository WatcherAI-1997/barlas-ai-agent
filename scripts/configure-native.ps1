[CmdletBinding()]
param(
    [ValidateSet("wizard", "list", "get", "set", "unset", "file", "schema", "validate", "models-status", "channels-status", "security-audit")]
    [string]$Action = "wizard",
    [ValidateSet("all", "general", "models", "channels", "agent")][string]$Section = "all",
    [string]$Key,
    [string]$Value
)

$ErrorActionPreference = "Stop"
$RootDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$EnvFile = Join-Path $RootDir "deploy\native.env"
$AllowedKeys = @(
    "PORT", "BARLAS_HTTP_PORT", "OWNER_EMAIL", "OWNER_DISPLAY_NAME", "OWNER_LANGUAGE",
    "MODEL_PROVIDER", "MODEL_NAME", "MODEL_API_KEY", "OLLAMA_BASE_URL", "DEEP_MODEL_NAME", "MEDIA_API_KEY", "VISION_MODEL",
    "TRANSCRIPTION_MODEL", "SPEECH_MODEL", "EMBEDDING_MODEL", "TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET",
    "TELEGRAM_POLLING_ENABLED", "DISCORD_BOT_TOKEN", "DISCORD_GATEWAY_ENABLED", "SLACK_BOT_TOKEN", "SLACK_APP_TOKEN", "SLACK_SOCKET_MODE_ENABLED", "AGENT_MAX_STEPS", "AGENT_MAX_TOTAL_TOKENS", "AGENT_MAX_OUTPUT_TOKENS_PER_STEP",
    "DAILY_CHAT_QUOTA", "DAILY_TOOL_QUOTA", "DAILY_JOB_QUOTA"
)
$SecretKeys = @("MODEL_API_KEY", "MEDIA_API_KEY", "TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET", "DISCORD_BOT_TOKEN", "SLACK_BOT_TOKEN", "SLACK_APP_TOKEN", "BARLAS_API_TOKEN", "BARLAS_GATEWAY_TOKEN", "CONNECTOR_VAULT_KEY")

function Unquote-Value([string]$Raw) {
    if ($Raw.Length -ge 2 -and $Raw[0] -eq "'" -and $Raw[$Raw.Length - 1] -eq "'") { return $Raw.Substring(1, $Raw.Length - 2).Replace("\'", "'") }
    return $Raw.Trim('"')
}
function Quote-Value([string]$Raw) {
    if ($Raw.Contains("`r") -or $Raw.Contains("`n")) { throw "Configuration values must be one line" }
    return "'" + $Raw.Replace("'", "\'") + "'"
}
function Protect-File([string]$Path) {
    $Identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    $Acl = New-Object Security.AccessControl.FileSecurity
    $Acl.SetAccessRuleProtection($true, $false)
    $Acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($Identity, [Security.AccessControl.FileSystemRights]::FullControl, [Security.AccessControl.AccessControlType]::Allow))
    $Acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new("NT AUTHORITY\SYSTEM", [Security.AccessControl.FileSystemRights]::FullControl, [Security.AccessControl.AccessControlType]::Allow))
    Set-Acl -LiteralPath $Path -AclObject $Acl
}
function New-RandomHex([int]$Bytes) {
    $Buffer = New-Object byte[] $Bytes
    $Generator = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $Generator.GetBytes($Buffer) } finally { $Generator.Dispose() }
    return -join ($Buffer | ForEach-Object { $_.ToString("x2") })
}
function Read-Plain([string]$Prompt, [string]$Default = "") {
    $Label = if ($Default) { "$Prompt [$Default]" } else { $Prompt }
    $Answer = Read-Host $Label
    if ([string]::IsNullOrWhiteSpace($Answer)) { return $Default }
    return $Answer.Trim()
}
function Read-Secret([string]$Prompt) {
    $Secure = Read-Host $Prompt -AsSecureString
    $Pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($Pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($Pointer) }
}

if (-not (Test-Path -LiteralPath $EnvFile -PathType Leaf)) { throw "Native configuration not found. Install Barlas first." }
$Settings = [ordered]@{}
foreach ($Line in [IO.File]::ReadAllLines($EnvFile)) {
    if ($Line -match '^([A-Z][A-Z0-9_]*)=(.*)$') { $Settings[$Matches[1]] = Unquote-Value $Matches[2] }
}
function Current([string]$Name, [string]$Fallback = "") {
    if ($Settings.Contains($Name)) { return [string]$Settings[$Name] }
    return $Fallback
}
function Set-Value([string]$Name, [string]$NewValue) { $Settings[$Name] = $NewValue }
function Save-Settings {
    $Temporary = "$EnvFile.tmp.$([Guid]::NewGuid().ToString('N'))"
    try {
        $Lines = foreach ($Entry in $Settings.GetEnumerator()) { "$($Entry.Key)=$(Quote-Value ([string]$Entry.Value))" }
        [IO.File]::WriteAllLines($Temporary, $Lines, (New-Object Text.UTF8Encoding($false)))
        Protect-File $Temporary
        Move-Item -LiteralPath $Temporary -Destination $EnvFile -Force
        Protect-File $EnvFile
    } finally { Remove-Item -LiteralPath $Temporary -Force -ErrorAction SilentlyContinue }
}
function Configure-General {
    Write-Host "`n[General]" -ForegroundColor Cyan
    $Port = Read-Plain "Local web port" (Current "PORT" "17840")
    if ($Port -notmatch '^\d+$' -or [int]$Port -lt 1024 -or [int]$Port -gt 65535) { throw "Port must be between 1024 and 65535" }
    Set-Value "PORT" $Port; Set-Value "BARLAS_HTTP_PORT" $Port
    $Email = Read-Plain "Owner email" (Current "OWNER_EMAIL" "owner@barlas.local")
    if ($Email -notmatch '^.+@.+\..+$') { throw "Owner email is invalid" }
    Set-Value "OWNER_EMAIL" $Email
    Set-Value "OWNER_DISPLAY_NAME" (Read-Plain "Owner display name" (Current "OWNER_DISPLAY_NAME" "Barlas Owner"))
    Set-Value "OWNER_LANGUAGE" (Read-Plain "Language code" (Current "OWNER_LANGUAGE" "ru"))
}
function Configure-Models {
    Write-Host "`n[Models]" -ForegroundColor Cyan
    $Provider = (Read-Plain "Provider: openai, anthropic, or local ollama" (Current "MODEL_PROVIDER" "openai")).ToLowerInvariant()
    if ($Provider -notin @("openai", "anthropic", "ollama")) { throw "Provider must be openai, anthropic, or ollama" }
    Set-Value "MODEL_PROVIDER" $Provider
    Set-Value "MODEL_NAME" (Read-Plain "Default model" (Current "MODEL_NAME"))
    Set-Value "DEEP_MODEL_NAME" (Read-Plain "Deep model" (Current "DEEP_MODEL_NAME" (Current "MODEL_NAME")))
    if ($Provider -eq "ollama") {
        Set-Value "MODEL_API_KEY" ""
        Set-Value "OLLAMA_BASE_URL" (Read-Plain "Ollama URL" (Current "OLLAMA_BASE_URL" "http://127.0.0.1:11434"))
    } else {
        $NewKey = Read-Secret "Model API key (blank keeps current)"
        if ($NewKey) { Set-Value "MODEL_API_KEY" $NewKey }
    }
    Set-Value "VISION_MODEL" (Read-Plain "Vision/PDF model; blank disables" (Current "VISION_MODEL"))
    Set-Value "TRANSCRIPTION_MODEL" (Read-Plain "Transcription model" (Current "TRANSCRIPTION_MODEL" "gpt-4o-mini-transcribe"))
    Set-Value "SPEECH_MODEL" (Read-Plain "Speech model" (Current "SPEECH_MODEL" "gpt-4o-mini-tts"))
}
function Configure-Channels {
    Write-Host "`n[Channels]" -ForegroundColor Cyan
    $Configured = -not [string]::IsNullOrWhiteSpace((Current "TELEGRAM_BOT_TOKEN"))
    Write-Host "Telegram: $(if ($Configured) { 'configured' } else { 'disabled' })"
    $Choice = Read-Plain "Telegram action: keep, configure, disable" "keep"
    if ($Choice -eq "configure") {
        $TelegramToken = Read-Secret "Telegram bot token"
        if ($TelegramToken.Length -lt 20) { throw "Telegram bot token is invalid" }
        Set-Value "TELEGRAM_BOT_TOKEN" $TelegramToken
        Set-Value "TELEGRAM_WEBHOOK_SECRET" (New-RandomHex 32)
        Set-Value "TELEGRAM_POLLING_ENABLED" "true"
    } elseif ($Choice -eq "disable") {
        foreach ($Name in @("TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET", "TELEGRAM_POLLING_ENABLED")) { $Settings.Remove($Name) }
    } elseif ($Choice -ne "keep") { throw "Choose keep, configure, or disable" }
    $DiscordConfigured = -not [string]::IsNullOrWhiteSpace((Current "DISCORD_BOT_TOKEN"))
    Write-Host "Discord: $(if ($DiscordConfigured) { 'configured (Gateway)' } else { 'disabled' })"
    $DiscordChoice = Read-Plain "Discord action: keep, configure, disable" "keep"
    if ($DiscordChoice -eq "configure") {
        $DiscordToken = Read-Secret "Discord bot token"
        if ($DiscordToken.Length -lt 20) { throw "Discord bot token is invalid" }
        Set-Value "DISCORD_BOT_TOKEN" $DiscordToken
        Set-Value "DISCORD_GATEWAY_ENABLED" "true"
    } elseif ($DiscordChoice -eq "disable") {
        foreach ($Name in @("DISCORD_BOT_TOKEN", "DISCORD_GATEWAY_ENABLED")) { $Settings.Remove($Name) }
    } elseif ($DiscordChoice -ne "keep") { throw "Choose keep, configure, or disable" }
    $SlackConfigured = (Current "SLACK_BOT_TOKEN") -and (Current "SLACK_APP_TOKEN")
    Write-Host "Slack: $(if ($SlackConfigured) { 'configured (Socket Mode)' } else { 'disabled' })"
    $SlackChoice = Read-Plain "Slack action: keep, configure, disable" "keep"
    if ($SlackChoice -eq "configure") {
        $SlackBotToken = Read-Secret "Slack bot token (xoxb-...)"
        $SlackAppToken = Read-Secret "Slack app token (xapp-...)"
        if (-not $SlackBotToken.StartsWith("xoxb-") -or -not $SlackAppToken.StartsWith("xapp-")) { throw "Slack tokens are invalid" }
        Set-Value "SLACK_BOT_TOKEN" $SlackBotToken
        Set-Value "SLACK_APP_TOKEN" $SlackAppToken
        Set-Value "SLACK_SOCKET_MODE_ENABLED" "true"
    } elseif ($SlackChoice -eq "disable") {
        foreach ($Name in @("SLACK_BOT_TOKEN", "SLACK_APP_TOKEN", "SLACK_SOCKET_MODE_ENABLED")) { $Settings.Remove($Name) }
    } elseif ($SlackChoice -ne "keep") { throw "Choose keep, configure, or disable" }
}
function Configure-Agent {
    Write-Host "`n[Agent]" -ForegroundColor Cyan
    $Steps = Read-Plain "Maximum steps per run" (Current "AGENT_MAX_STEPS" "8")
    if ($Steps -notmatch '^\d+$' -or [int]$Steps -lt 1 -or [int]$Steps -gt 12) { throw "Steps must be between 1 and 12" }
    Set-Value "AGENT_MAX_STEPS" $Steps
    Set-Value "AGENT_MAX_TOTAL_TOKENS" (Read-Plain "Maximum total tokens" (Current "AGENT_MAX_TOTAL_TOKENS" "50000"))
    Set-Value "DAILY_CHAT_QUOTA" (Read-Plain "Daily chat quota" (Current "DAILY_CHAT_QUOTA" "500"))
    Set-Value "DAILY_TOOL_QUOTA" (Read-Plain "Daily tool quota" (Current "DAILY_TOOL_QUOTA" "1000"))
    Set-Value "DAILY_JOB_QUOTA" (Read-Plain "Daily job quota" (Current "DAILY_JOB_QUOTA" "100"))
}

if ($Action -eq "list") {
    foreach ($Name in $AllowedKeys) {
        if ($Settings.Contains($Name)) { Write-Output "$Name=$(if ($Name -in $SecretKeys) { '<redacted>' } else { [string]$Settings[$Name] })" }
    }
    return
}
if ($Action -eq "file") { Write-Output $EnvFile; return }
if ($Action -eq "schema") {
    foreach ($Name in $AllowedKeys) { Write-Output "$Name$(if ($Name -in $SecretKeys) { ' (secret)' } else { '' })" }
    return
}
if ($Action -eq "validate") {
    $Problems = @()
    if ((Current "HOST" "127.0.0.1") -ne "127.0.0.1") { $Problems += "HOST must remain 127.0.0.1 in native mode" }
    $Port = Current "PORT"
    if ($Port -notmatch '^\d+$' -or [int]$Port -lt 1024 -or [int]$Port -gt 65535) { $Problems += "PORT is invalid" }
    if ((Current "MODEL_PROVIDER") -notin @("openai", "anthropic", "ollama")) { $Problems += "MODEL_PROVIDER is invalid" }
    foreach ($Required in @("MODEL_NAME", "BARLAS_GATEWAY_TOKEN", "BARLAS_API_TOKEN", "CONNECTOR_VAULT_KEY")) {
        if ([string]::IsNullOrWhiteSpace((Current $Required))) { $Problems += "$Required is missing" }
    }
    if ((Current "MODEL_PROVIDER") -ne "ollama" -and [string]::IsNullOrWhiteSpace((Current "MODEL_API_KEY"))) { $Problems += "MODEL_API_KEY is missing" }
    if ((Current "BARLAS_GATEWAY_TOKEN").Length -lt 32) { $Problems += "BARLAS_GATEWAY_TOKEN is too short" }
    if ($Problems.Count -gt 0) { throw ($Problems -join "; ") }
    Write-Output "Configuration: valid"
    return
}
if ($Action -eq "get") {
    if ($Key -notin $AllowedKeys) { throw "Unknown or protected setting: $Key" }
    if ($Key -in $SecretKeys) { Write-Output "$Key=<redacted>" } else { Write-Output "$Key=$(Current $Key)" }
    return
}
if ($Action -in @("set", "unset")) {
    if ($Key -notin $AllowedKeys) { throw "Unknown or protected setting: $Key" }
    if ($Action -eq "unset") { $Settings.Remove($Key) }
    else {
        if ($Key -in $SecretKeys -and -not [string]::IsNullOrWhiteSpace($Value)) { throw "Do not put secrets in command history. Omit the value and enter it securely." }
        if ($Key -in $SecretKeys) { $Value = Read-Secret "$Key" }
        if ([string]::IsNullOrWhiteSpace($Value)) { throw "Value is required" }
        Set-Value $Key $Value
        if ($Key -eq "PORT") { Set-Value "BARLAS_HTTP_PORT" $Value }
    }
    Save-Settings
    Write-Host "[OK] Configuration updated" -ForegroundColor Green
    return
}
if ($Action -eq "models-status") {
    Write-Output "Provider: $(Current 'MODEL_PROVIDER')"
    Write-Output "Default model: $(Current 'MODEL_NAME')"
    Write-Output "Deep model: $(Current 'DEEP_MODEL_NAME')"
    if ((Current "MODEL_PROVIDER") -eq "ollama") { Write-Output "Ollama URL: $(Current 'OLLAMA_BASE_URL' 'http://127.0.0.1:11434')" }
    Write-Output "Vision model: $(Current 'VISION_MODEL' 'disabled')"
    Write-Output "API key: $(if ((Current 'MODEL_PROVIDER') -eq 'ollama') { 'not required' } elseif (Current 'MODEL_API_KEY') { 'configured' } else { 'missing' })"
    if ((Current "MODEL_PROVIDER") -eq "ollama") {
        $BaseUrl = Current "OLLAMA_BASE_URL" "http://127.0.0.1:11434"
        try {
            $Tags = Invoke-RestMethod -Uri "$($BaseUrl.TrimEnd('/'))/api/tags" -TimeoutSec 5
            $Names = @($Tags.models | ForEach-Object { $_.name })
            Write-Output "Ollama API: reachable"
            Write-Output "Selected model: $(if ($Names -contains (Current 'MODEL_NAME')) { 'installed' } else { 'not installed' })"
        } catch { Write-Output "Ollama API: unavailable" }
    }
    return
}
if ($Action -eq "channels-status") {
    Write-Output "Telegram: $(if (Current 'TELEGRAM_BOT_TOKEN') { 'configured (long polling)' } else { 'disabled' })"
    Write-Output "Discord: $(if (Current 'DISCORD_BOT_TOKEN') { 'configured (Gateway)' } else { 'disabled' })"
    Write-Output "Slack: $(if ((Current 'SLACK_BOT_TOKEN') -and (Current 'SLACK_APP_TOKEN')) { 'configured (Socket Mode)' } else { 'disabled' })"
    return
}
if ($Action -eq "security-audit") {
    $Acl = Get-Acl -LiteralPath $EnvFile
    $Unsafe = @($Acl.Access | Where-Object { $_.IdentityReference -notmatch 'SYSTEM$' -and $_.IdentityReference -ne [Security.Principal.WindowsIdentity]::GetCurrent().Name })
    Write-Output "Bind address: $(Current 'HOST' '127.0.0.1')"
    Write-Output "Gateway token: $(if ((Current 'BARLAS_GATEWAY_TOKEN').Length -ge 32) { 'strong' } else { 'invalid' })"
    Write-Output "Config ACL: $(if ($Unsafe.Count -eq 0) { 'restricted' } else { 'review required' })"
    Write-Output "Native sandbox: not container-isolated"
    return
}

Write-Host "Barlas setup" -ForegroundColor White
Write-Host "Press Enter to keep an existing value. Secret values are never displayed." -ForegroundColor DarkGray
if ($Section -in @("all", "general")) { Configure-General }
if ($Section -in @("all", "models")) { Configure-Models }
if ($Section -in @("all", "channels")) { Configure-Channels }
if ($Section -in @("all", "agent")) { Configure-Agent }
Save-Settings
Write-Host "`n[OK] Configuration saved securely" -ForegroundColor Green
Write-Host "Built-in skills: enabled | Memory: enabled | Approvals: enabled | Browser: enabled" -ForegroundColor DarkGray
Write-Host "Native code sandbox: not container-isolated" -ForegroundColor DarkGray
