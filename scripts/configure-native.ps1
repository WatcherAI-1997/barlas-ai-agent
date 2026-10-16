[CmdletBinding()]
param(
    [ValidateSet("wizard", "list", "get", "set", "unset", "file", "schema", "validate", "models-status", "channels-status", "security-audit")]
    [string]$Action = "wizard",
    [ValidateSet("all", "general", "identity", "models", "memory", "channels", "integrations", "automations", "security", "agent")][string]$Section = "all",
    [ValidateSet("", "quick", "private", "developer", "server", "import")][string]$Profile = "",
    [string]$Key,
    [string]$Value
)

$ErrorActionPreference = "Stop"
$RootDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$EnvFile = Join-Path $RootDir "deploy\native.env"
$AllowedKeys = @(
    "PORT", "BARLAS_HTTP_PORT", "OWNER_EMAIL", "OWNER_DISPLAY_NAME", "OWNER_LANGUAGE",
    "MODEL_PROVIDER", "MODEL_NAME", "MODEL_API_KEY", "OLLAMA_BASE_URL", "DEEP_MODEL_NAME", "MEDIA_API_KEY", "VISION_MODEL",
    "TRANSCRIPTION_MODEL", "SPEECH_MODEL", "DEFAULT_SPEECH_VOICE", "EMBEDDING_MODEL", "TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET",
    "TELEGRAM_POLLING_ENABLED", "DISCORD_BOT_TOKEN", "DISCORD_GATEWAY_ENABLED", "SLACK_BOT_TOKEN", "SLACK_APP_TOKEN", "SLACK_SOCKET_MODE_ENABLED", "AGENT_MAX_STEPS", "AGENT_MAX_TOTAL_TOKENS", "AGENT_MAX_OUTPUT_TOKENS_PER_STEP",
    "DAILY_CHAT_QUOTA", "DAILY_TOOL_QUOTA", "DAILY_JOB_QUOTA", "AGENT_NAME", "AGENT_STYLE", "AGENT_INSTRUCTIONS",
    "JOB_WORKER_ENABLED", "AGENT_RUN_WORKER_ENABLED", "SESSION_TTL_HOURS", "MAX_WORKSPACE_FILE_BYTES"
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
function Read-Choice([string]$Prompt, [string[]]$Choices, [string]$Default) {
    $Answer = (Read-Plain "$Prompt ($($Choices -join '/'))" $Default).ToLowerInvariant()
    if ($Answer -notin $Choices) { throw "Choose one of: $($Choices -join ', ')" }
    return $Answer
}
function Write-Step([int]$Number, [int]$Total, [string]$Title) {
    Write-Host "`n[$Number/$Total] $Title" -ForegroundColor Cyan
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
    Write-Step 1 9 "General"
    $Port = Read-Plain "Local web port" (Current "PORT" "17840")
    if ($Port -notmatch '^\d+$' -or [int]$Port -lt 1024 -or [int]$Port -gt 65535) { throw "Port must be between 1024 and 65535" }
    Set-Value "PORT" $Port; Set-Value "BARLAS_HTTP_PORT" $Port
    $Email = Read-Plain "Owner email" (Current "OWNER_EMAIL" "owner@barlas.local")
    if ($Email -notmatch '^.+@.+\..+$') { throw "Owner email is invalid" }
    Set-Value "OWNER_EMAIL" $Email
    Set-Value "OWNER_DISPLAY_NAME" (Read-Plain "Owner display name" (Current "OWNER_DISPLAY_NAME" "Barlas Owner"))
    Set-Value "OWNER_LANGUAGE" (Read-Plain "Language code" (Current "OWNER_LANGUAGE" "ru"))
}
function Configure-Identity {
    Write-Step 2 9 "Agent identity"
    $Name = Read-Plain "Agent name" (Current "AGENT_NAME" "Barlas")
    if ($Name.Length -lt 1 -or $Name.Length -gt 80) { throw "Agent name must be between 1 and 80 characters" }
    Set-Value "AGENT_NAME" $Name
    $Style = Read-Choice "Conversation style" @("balanced", "concise", "warm", "analytical", "creative") (Current "AGENT_STYLE" "balanced")
    Set-Value "AGENT_STYLE" $Style
    $Instructions = Read-Plain "Personal instructions; blank keeps current" (Current "AGENT_INSTRUCTIONS")
    if ($Instructions.Length -gt 4000) { throw "Personal instructions are limited to 4000 characters" }
    Set-Value "AGENT_INSTRUCTIONS" $Instructions
}
function Configure-Models {
    Write-Step 3 9 "Models and voice"
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
    Set-Value "DEFAULT_SPEECH_VOICE" (Read-Choice "Default voice" @("alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse") (Current "DEFAULT_SPEECH_VOICE" "alloy"))
    if ($Provider -ne "ollama") {
        $MediaChoice = Read-Choice "Media API key" @("keep", "configure", "disable") "keep"
        if ($MediaChoice -eq "configure") {
            $MediaKey = Read-Secret "Media API key"
            if ($MediaKey.Length -lt 8) { throw "Media API key is invalid" }
            Set-Value "MEDIA_API_KEY" $MediaKey
        } elseif ($MediaChoice -eq "disable") { $Settings.Remove("MEDIA_API_KEY") }
    }
}
function Configure-Memory {
    Write-Step 4 9 "Memory"
    $Mode = Read-Choice "Memory mode" @("standard", "semantic") "$(if (Current 'EMBEDDING_MODEL') { 'semantic' } else { 'standard' })"
    if ($Mode -eq "semantic") {
        Set-Value "EMBEDDING_MODEL" (Read-Plain "Embedding model" (Current "EMBEDDING_MODEL" "text-embedding-3-small"))
    } else { $Settings.Remove("EMBEDDING_MODEL") }
}
function Configure-Channels {
    Write-Step 5 9 "Channels"
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
function Configure-Integrations {
    Write-Step 6 9 "Integrations and skills"
    Write-Host "After restart, run: barlas integrations add PROVIDER LABEL" -ForegroundColor Cyan
    Write-Host "Supported providers: github, google_drive, gmail, google_calendar, mcp_http." -ForegroundColor DarkGray
    Write-Host "The token is entered with hidden input, encrypted in the vault, and can be tested with: barlas integrations test ID" -ForegroundColor DarkGray
    Write-Host "Built-in skills are ready. Signed catalog skills always require explicit trust and evaluation." -ForegroundColor DarkGray
}
function Configure-Automations {
    Write-Step 7 9 "Automations and limits"
    $Steps = Read-Plain "Maximum steps per run" (Current "AGENT_MAX_STEPS" "8")
    if ($Steps -notmatch '^\d+$' -or [int]$Steps -lt 1 -or [int]$Steps -gt 12) { throw "Steps must be between 1 and 12" }
    Set-Value "AGENT_MAX_STEPS" $Steps
    Set-Value "AGENT_MAX_TOTAL_TOKENS" (Read-Plain "Maximum total tokens" (Current "AGENT_MAX_TOTAL_TOKENS" "50000"))
    Set-Value "DAILY_CHAT_QUOTA" (Read-Plain "Daily chat quota" (Current "DAILY_CHAT_QUOTA" "500"))
    Set-Value "DAILY_TOOL_QUOTA" (Read-Plain "Daily tool quota" (Current "DAILY_TOOL_QUOTA" "1000"))
    Set-Value "DAILY_JOB_QUOTA" (Read-Plain "Daily job quota" (Current "DAILY_JOB_QUOTA" "100"))
    Set-Value "JOB_WORKER_ENABLED" (Read-Choice "Scheduled jobs" @("true", "false") (Current "JOB_WORKER_ENABLED" "true"))
    Set-Value "AGENT_RUN_WORKER_ENABLED" (Read-Choice "Background agent runs" @("true", "false") (Current "AGENT_RUN_WORKER_ENABLED" "true"))
}
function Configure-Security {
    Write-Step 8 9 "Security"
    Write-Host "Gateway stays bound to 127.0.0.1. Secrets remain in the protected native configuration." -ForegroundColor DarkGray
    $FileLimit = Read-Plain "Maximum workspace file bytes" (Current "MAX_WORKSPACE_FILE_BYTES" "2000000000")
    if ($FileLimit -notmatch '^\d+$' -or [int64]$FileLimit -lt 1000000 -or [int64]$FileLimit -gt 10000000000000) { throw "File limit must be between 1 MB and 10 TB" }
    Set-Value "MAX_WORKSPACE_FILE_BYTES" $FileLimit
    Set-Value "SESSION_TTL_HOURS" (Read-Plain "Session lifetime in hours" (Current "SESSION_TTL_HOURS" "168"))
}
function Apply-Profile([string]$SelectedProfile) {
    if ($SelectedProfile -eq "quick") {
        Set-Value "AGENT_STYLE" (Current "AGENT_STYLE" "balanced")
        Set-Value "JOB_WORKER_ENABLED" "true"; Set-Value "AGENT_RUN_WORKER_ENABLED" "true"
    } elseif ($SelectedProfile -eq "private") {
        Set-Value "MODEL_PROVIDER" "ollama"; Set-Value "MODEL_API_KEY" ""; Set-Value "MEDIA_API_KEY" ""
        Set-Value "OLLAMA_BASE_URL" (Current "OLLAMA_BASE_URL" "http://127.0.0.1:11434")
        foreach ($Name in @("TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET", "TELEGRAM_POLLING_ENABLED", "DISCORD_BOT_TOKEN", "DISCORD_GATEWAY_ENABLED", "SLACK_BOT_TOKEN", "SLACK_APP_TOKEN", "SLACK_SOCKET_MODE_ENABLED")) { $Settings.Remove($Name) }
    } elseif ($SelectedProfile -eq "developer") {
        Set-Value "AGENT_MAX_STEPS" "12"; Set-Value "AGENT_MAX_TOTAL_TOKENS" "100000"
        Set-Value "JOB_WORKER_ENABLED" "true"; Set-Value "AGENT_RUN_WORKER_ENABLED" "true"
    } elseif ($SelectedProfile -eq "server") {
        Set-Value "AGENT_MAX_STEPS" "12"; Set-Value "AGENT_MAX_TOTAL_TOKENS" "150000"
        Set-Value "DAILY_CHAT_QUOTA" "5000"; Set-Value "DAILY_TOOL_QUOTA" "10000"; Set-Value "DAILY_JOB_QUOTA" "1000"
        Write-Host "Native Windows remains local-only. Public server deployment uses the hardened server installer." -ForegroundColor Yellow
    }
}
function Import-BarlasConfig {
    Write-Step 1 9 "Import existing Barlas configuration"
    $Source = Read-Plain "Path to a Barlas .env file"
    if (-not (Test-Path -LiteralPath $Source -PathType Leaf)) { throw "Import file not found" }
    $Item = Get-Item -LiteralPath $Source
    if ($Item.Length -gt 131072) { throw "Import file is too large" }
    $Imported = 0
    foreach ($Line in [IO.File]::ReadAllLines($Item.FullName)) {
        if ($Line -match '^([A-Z][A-Z0-9_]*)=(.*)$' -and $Matches[1] -in $AllowedKeys) {
            Set-Value $Matches[1] (Unquote-Value $Matches[2]); $Imported++
        }
    }
    if ($Imported -eq 0) { throw "No supported Barlas settings were found" }
    Write-Host "Imported $Imported supported settings. Protected runtime tokens were preserved." -ForegroundColor Green
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
    if ((Current "AGENT_NAME" "Barlas").Length -gt 80) { $Problems += "AGENT_NAME is too long" }
    if ((Current "AGENT_STYLE" "balanced") -notin @("balanced", "concise", "warm", "analytical", "creative")) { $Problems += "AGENT_STYLE is invalid" }
    if ((Current "AGENT_INSTRUCTIONS").Length -gt 4000) { $Problems += "AGENT_INSTRUCTIONS is too long" }
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

Write-Host "`n  B A R L A S" -ForegroundColor White
Write-Host "  Personal AI setup" -ForegroundColor DarkGray
Write-Host "  Press Enter to keep a value. Secrets are never displayed." -ForegroundColor DarkGray

if ($Section -eq "all") {
    if (-not $Profile) {
        Write-Host "`nSetup profiles" -ForegroundColor Cyan
        Write-Host "  quick      Essential choices, sensible defaults"
        Write-Host "  private    Local Ollama, no cloud key, no external channels"
        Write-Host "  developer  Advanced limits, tools and diagnostics"
        Write-Host "  server     Higher worker limits with hardened checks"
        Write-Host "  import     Import a previous Barlas configuration"
        $Profile = Read-Choice "Choose profile" @("quick", "private", "developer", "server", "import") "quick"
    }
    if ($Profile -eq "import") { Import-BarlasConfig } else { Apply-Profile $Profile }
}

$Sections = if ($Section -eq "all") {
    if ($Profile -eq "quick") { @("general", "identity", "models", "channels", "security") }
    elseif ($Profile -eq "import") { @("security") }
    else { @("general", "identity", "models", "memory", "channels", "integrations", "automations", "security") }
} elseif ($Section -eq "agent") { @("identity", "automations") } else { @($Section) }

if ("general" -in $Sections) { Configure-General }
if ("identity" -in $Sections) { Configure-Identity }
if ("models" -in $Sections) { Configure-Models }
if ("memory" -in $Sections) { Configure-Memory }
if ("channels" -in $Sections) { Configure-Channels }
if ("integrations" -in $Sections) { Configure-Integrations }
if ("automations" -in $Sections) { Configure-Automations }
if ("security" -in $Sections) { Configure-Security }
Save-Settings
Write-Step 9 9 "Review"
Write-Host "  Profile:       $(if ($Profile) { $Profile } else { 'custom' })"
Write-Host "  Agent:         $(Current 'AGENT_NAME' 'Barlas') ($(Current 'AGENT_STYLE' 'balanced'))"
Write-Host "  Model:         $(Current 'MODEL_PROVIDER') / $(Current 'MODEL_NAME')"
Write-Host "  Memory:        $(if (Current 'EMBEDDING_MODEL') { 'semantic' } else { 'standard' })"
Write-Host "  Telegram:      $(if (Current 'TELEGRAM_BOT_TOKEN') { 'configured' } else { 'disabled' })"
Write-Host "  Discord:       $(if (Current 'DISCORD_BOT_TOKEN') { 'configured' } else { 'disabled' })"
Write-Host "  Slack:         $(if ((Current 'SLACK_BOT_TOKEN') -and (Current 'SLACK_APP_TOKEN')) { 'configured' } else { 'disabled' })"
Write-Host "`n[OK] Configuration saved securely" -ForegroundColor Green
Write-Host "The gateway will restart and run final diagnostics." -ForegroundColor DarkGray
