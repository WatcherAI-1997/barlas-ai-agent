[CmdletBinding()]
param(
    [ValidateSet("wizard", "list", "get", "set", "unset", "file", "schema", "validate", "models-status", "channels-status", "security-audit")]
    [string]$Action = "wizard",
    [ValidateSet("all", "general", "identity", "models", "memory", "tools", "channels", "integrations", "automations", "security", "agent")][string]$Section = "all",
    [ValidateSet("", "complete", "quick", "private", "developer", "server", "import")][string]$Profile = "",
    [string]$Key,
    [string]$Value
)

$ErrorActionPreference = "Stop"
$RootDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$EnvFile = Join-Path $RootDir "deploy\native.env"
$AllowedKeys = @(
    "PORT", "BARLAS_HTTP_PORT", "OWNER_EMAIL", "OWNER_DISPLAY_NAME", "OWNER_LANGUAGE",
    "MODEL_PROVIDER", "MODEL_NAME", "MODEL_API_KEY", "MODEL_BASE_URL", "OLLAMA_BASE_URL", "DEEP_MODEL_NAME", "MEDIA_API_KEY", "VISION_MODEL",
    "TRANSCRIPTION_MODEL", "SPEECH_MODEL", "DEFAULT_SPEECH_VOICE", "EMBEDDING_MODEL", "TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET",
    "TELEGRAM_POLLING_ENABLED", "DISCORD_BOT_TOKEN", "DISCORD_GATEWAY_ENABLED", "SLACK_BOT_TOKEN", "SLACK_APP_TOKEN", "SLACK_SOCKET_MODE_ENABLED",
    "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_VERIFY_TOKEN", "WHATSAPP_APP_SECRET", "WHATSAPP_GRAPH_API_BASE_URL",
    "AGENT_MAX_STEPS", "AGENT_MAX_TOTAL_TOKENS", "AGENT_MAX_OUTPUT_TOKENS_PER_STEP",
    "DAILY_CHAT_QUOTA", "DAILY_TOOL_QUOTA", "DAILY_JOB_QUOTA", "AGENT_NAME", "AGENT_STYLE", "AGENT_INSTRUCTIONS",
    "JOB_WORKER_ENABLED", "AGENT_RUN_WORKER_ENABLED", "SESSION_TTL_HOURS", "MAX_WORKSPACE_FILE_BYTES",
    "BROWSER_WS_ENDPOINT", "SEARXNG_BASE_URL", "LOG_LEVEL", "TELEGRAM_BOT_API_BASE_URL", "TELEGRAM_MAX_UPLOAD_BYTES"
)
$SecretKeys = @("MODEL_API_KEY", "MEDIA_API_KEY", "TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET", "DISCORD_BOT_TOKEN", "SLACK_BOT_TOKEN", "SLACK_APP_TOKEN", "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_VERIFY_TOKEN", "WHATSAPP_APP_SECRET", "BARLAS_API_TOKEN", "BARLAS_GATEWAY_TOKEN", "CONNECTOR_VAULT_KEY")

function Unquote-Value([string]$Raw) {
    if ($Raw.Length -ge 2 -and $Raw[0] -eq "'" -and $Raw[$Raw.Length - 1] -eq "'") { return $Raw.Substring(1, $Raw.Length - 2).Replace("\'", "'") }
    return $Raw.Trim('"')
}
function Quote-Value([string]$Raw) {
    if ($Raw.Contains("`r") -or $Raw.Contains("`n")) { throw "Configuration values must be one line" }
    return "'" + $Raw.Replace("'", "\'") + "'"
}
function Protect-File([string]$Path) {
    $UserSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $PreviousPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        & icacls.exe $Path "/inheritance:r" "/grant:r" "*${UserSid}:(F)" "*S-1-5-18:(F)" *> $null
        $AclExitCode = $LASTEXITCODE
    } finally { $ErrorActionPreference = $PreviousPreference }
    if ($AclExitCode -ne 0) { throw "Unable to protect the Barlas configuration file for the current Windows user." }
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

function Read-ArrowChoice([string[]]$Values, [string[]]$Labels, [string]$Default) {
    $CursorCaptured = $false
    try {
        if ([Console]::IsInputRedirected -or [Console]::IsOutputRedirected) { return $null }
        $Width = [Console]::WindowWidth - 1
        if ($Width -lt 20) { return $null }
        $DefaultIndex = [Array]::IndexOf($Values, $Default)
        if ($DefaultIndex -lt 0) { $DefaultIndex = 0 }
        $Filtered = @(0..($Values.Count - 1))
        $Selected = $DefaultIndex
        $Filter = ""
        $PageSize = [Math]::Min(10, [Math]::Max(3, [Console]::WindowHeight - 8))
        $ReservedLines = $PageSize + 2
        for ($Line = 0; $Line -lt $ReservedLines; $Line++) { Write-Host "" }
        $Top = [Console]::CursorTop - $ReservedLines
        $PreviousCursor = [Console]::CursorVisible
        $CursorCaptured = $true
        [Console]::CursorVisible = $false
        while ($true) {
            [Console]::SetCursorPosition(0, $Top)
            $Width = [Console]::WindowWidth - 1
            if ($Width -lt 20) { return $null }
            $SelectedPosition = [Array]::IndexOf($Filtered, $Selected)
            if ($SelectedPosition -lt 0) { $SelectedPosition = 0; if ($Filtered.Count) { $Selected = $Filtered[0] } }
            $WindowStart = if ($Filtered.Count -le $PageSize) { 0 } else { [Math]::Min([Math]::Max(0, $SelectedPosition - [Math]::Floor($PageSize / 2)), $Filtered.Count - $PageSize) }
            for ($Row = 0; $Row -lt $PageSize; $Row++) {
                $Position = $WindowStart + $Row
                if ($Position -lt $Filtered.Count) {
                    $Index = $Filtered[$Position]
                    $Prefix = if ($Index -eq $Selected) { "  > " } else { "    " }
                    $DefaultMarker = if ($Values[$Index] -eq $Default) { "  default" } else { "" }
                    $Text = "$Prefix$($Labels[$Index])$DefaultMarker"
                } else { $Text = "" }
                if ($Text.Length -gt $Width) { $Text = $Text.Substring(0, $Width) }
                if ($Position -lt $Filtered.Count -and $Filtered[$Position] -eq $Selected) { Write-Host $Text.PadRight($Width) -ForegroundColor Red }
                else { Write-Host $Text.PadRight($Width) }
            }
            $FilterLabel = if ($Filter) { "  Filter: $Filter  [$($Filtered.Count)/$($Values.Count)]" } else { "  Type to filter  [$($Filtered.Count) options]" }
            if ($FilterLabel.Length -gt $Width) { $FilterLabel = $FilterLabel.Substring(0, $Width) }
            Write-Host $FilterLabel.PadRight($Width) -ForegroundColor DarkGray
            $Help = "  ↑/↓ move · PgUp/PgDn · Home/End · Enter select · Esc default"
            if ($Help.Length -gt $Width) { $Help = $Help.Substring(0, $Width) }
            Write-Host $Help.PadRight($Width) -ForegroundColor DarkGray
            $Key = [Console]::ReadKey($true)
            if ($Key.Key -eq [ConsoleKey]::UpArrow -and $Filtered.Count) { $Selected = $Filtered[($SelectedPosition - 1 + $Filtered.Count) % $Filtered.Count]; continue }
            if ($Key.Key -eq [ConsoleKey]::DownArrow -and $Filtered.Count) { $Selected = $Filtered[($SelectedPosition + 1) % $Filtered.Count]; continue }
            if ($Key.Key -eq [ConsoleKey]::PageUp -and $Filtered.Count) { $Selected = $Filtered[[Math]::Max(0, $SelectedPosition - $PageSize)]; continue }
            if ($Key.Key -eq [ConsoleKey]::PageDown -and $Filtered.Count) { $Selected = $Filtered[[Math]::Min($Filtered.Count - 1, $SelectedPosition + $PageSize)]; continue }
            if ($Key.Key -eq [ConsoleKey]::Home -and $Filtered.Count) { $Selected = $Filtered[0]; continue }
            if ($Key.Key -eq [ConsoleKey]::End -and $Filtered.Count) { $Selected = $Filtered[$Filtered.Count - 1]; continue }
            if ($Key.Key -eq [ConsoleKey]::Enter -and $Filtered.Count) { return $Values[$Selected] }
            if ($Key.Key -eq [ConsoleKey]::Escape) { return $Default }
            if ($Key.Key -eq [ConsoleKey]::Backspace) {
                if ($Filter.Length) { $Filter = $Filter.Substring(0, $Filter.Length - 1) }
            } elseif (-not [char]::IsControl($Key.KeyChar)) { $Filter += $Key.KeyChar }
            else { continue }
            $Filtered = @()
            for ($Index = 0; $Index -lt $Values.Count; $Index++) {
                if (-not $Filter -or $Labels[$Index].IndexOf($Filter, [StringComparison]::OrdinalIgnoreCase) -ge 0 -or $Values[$Index].IndexOf($Filter, [StringComparison]::OrdinalIgnoreCase) -ge 0) { $Filtered += $Index }
            }
            if ($Filtered.Count -and $Selected -notin $Filtered) { $Selected = $Filtered[0] }
        }
    }
    catch { return $null }
    finally {
        if ($CursorCaptured) { try { [Console]::CursorVisible = $PreviousCursor } catch { } }
    }
}

function Read-MappedChoice([string]$Prompt, [string[]]$Values, [string[]]$Labels, [string]$Default) {
    if ($Values.Count -ne $Labels.Count) { throw "Invalid setup menu" }
    if ($Default -notin $Values) {
        Write-Host "The previous value is no longer supported; using $($Labels[0])." -ForegroundColor Yellow
        $Default = $Values[0]
    }
    Write-Host ""
    Write-Host $Prompt -ForegroundColor Cyan
    $ArrowChoice = Read-ArrowChoice $Values $Labels $Default
    if ($ArrowChoice) { return $ArrowChoice }
    for ($Index = 0; $Index -lt $Values.Count; $Index++) {
        $DefaultMarker = if ($Values[$Index] -eq $Default) { " (default)" } else { "" }
        Write-Host "  [$($Index + 1)] $($Labels[$Index])$DefaultMarker"
    }
    while ($true) {
        $DefaultNumber = 1 + [Array]::IndexOf($Values, $Default)
        $Answer = (Read-Host "Choose 1-$($Values.Count) [$DefaultNumber]").Trim().ToLowerInvariant()
        if (-not $Answer) { return $Default }
        $Number = 0
        if ([int]::TryParse($Answer, [ref]$Number)) {
            $Selected = $Number - 1
            if ($Selected -ge 0 -and $Selected -lt $Values.Count) { return $Values[$Selected] }
        }
        $Exact = [Array]::IndexOf($Values, $Answer)
        if ($Exact -ge 0) { return $Values[$Exact] }
        Write-Host "That option is not available. Choose a number from 1 to $($Values.Count)." -ForegroundColor Yellow
    }
}
function Read-Choice([string]$Prompt, [string[]]$Choices, [string]$Default) {
    return Read-MappedChoice $Prompt $Choices $Choices $Default
}
function Read-ValidatedPlain([string]$Prompt, [string]$Default, [scriptblock]$Validate, [string]$ErrorMessage) {
    while ($true) {
        $Value = Read-Plain $Prompt $Default
        if (& $Validate $Value) { return $Value }
        Write-Host $ErrorMessage -ForegroundColor Yellow
    }
}
function Read-BoundedInteger([string]$Prompt, [string]$Default, [int64]$Minimum, [int64]$Maximum) {
    return Read-ValidatedPlain $Prompt $Default {
        param($Candidate)
        $Parsed = [int64]0
        [int64]::TryParse([string]$Candidate, [ref]$Parsed) -and $Parsed -ge $Minimum -and $Parsed -le $Maximum
    } "Enter a whole number between $Minimum and $Maximum."
}
function Read-ModelSelection([string]$Provider, [string]$Prompt, [string]$Default) {
    if ($Provider -eq "codex_cli" -or $Provider -eq "openai") {
        $Values = @("gpt-6-astra", "gpt-6.1-sol", "gpt-6-sol", "gpt-6-luna", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5", "gpt-5.5-pro", "gpt-5.4", "gpt-5.4-pro", "gpt-5.4-mini", "gpt-5.4-nano", "custom")
    } elseif ($Provider -eq "anthropic") {
        $Values = @("claude-sonnet-4-5", "claude-haiku-4-5", "claude-opus-4-1", "custom")
    } elseif ($Provider -eq "ollama") {
        $Values = @("qwen3:8b", "qwen3:14b", "qwen3:30b", "gpt-oss:20b", "gpt-oss:120b", "llama3.3", "deepseek-r1", "custom")
    } else {
        $Values = @("custom")
    }
    $Labels = @($Values | ForEach-Object { if ($_ -eq "custom") { "Any other current, future, or installed model ID" } else { $_ } })
    $MenuDefault = if ($Default -in $Values) { $Default } else { "custom" }
    $Selected = Read-MappedChoice $Prompt $Values $Labels $MenuDefault
    if ($Selected -ne "custom") { return $Selected }
    return Read-ValidatedPlain "Model ID" $Default { param($Value) -not [string]::IsNullOrWhiteSpace([string]$Value) -and -not ([string]$Value).Contains("`r") -and -not ([string]$Value).Contains("`n") } "Model ID cannot be blank."
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
    Write-Step 1 10 "General"
    $Port = Read-ValidatedPlain "Local web port" (Current "PORT" "17840") {
        param($Candidate)
        $Parsed = 0
        [int]::TryParse([string]$Candidate, [ref]$Parsed) -and $Parsed -ge 1024 -and $Parsed -le 65535
    } "Enter a port between 1024 and 65535."
    Set-Value "PORT" $Port; Set-Value "BARLAS_HTTP_PORT" $Port
    $Email = Read-ValidatedPlain "Owner email" (Current "OWNER_EMAIL" "owner@barlas.local") {
        param($Candidate) [string]$Candidate -match '^[^\s@]+@[^\s@]+\.[^\s@]+$'
    } "Enter a valid email address."
    Set-Value "OWNER_EMAIL" $Email
    Set-Value "OWNER_DISPLAY_NAME" (Read-Plain "Owner display name" (Current "OWNER_DISPLAY_NAME" "Barlas Owner"))
    Set-Value "OWNER_LANGUAGE" (Read-Plain "Language code" (Current "OWNER_LANGUAGE" "ru"))
}
function Configure-Identity {
    Write-Step 2 10 "Agent identity"
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
    Write-Step 3 10 "Models and voice"
    $Provider = Read-MappedChoice "Model access" @("codex_cli", "openai", "anthropic", "ollama", "openai_compatible") @("OpenAI account - browser sign-in, no API key", "OpenAI API - usage-based key", "Anthropic API - usage-based key", "Ollama - local and private", "Compatible API - hosted or self-hosted endpoint") (Current "MODEL_PROVIDER" "codex_cli")
    Set-Value "MODEL_PROVIDER" $Provider
    if ($Provider -eq "codex_cli") {
        $AuthState = & (Join-Path $RootDir "scripts\model-auth-native.ps1") -Action status -Quiet
        if ($AuthState -ne "connected") { & (Join-Path $RootDir "scripts\model-auth-native.ps1") -Action login }
        Set-Value "MODEL_API_KEY" ""
    }
    $DefaultModel = if ($Provider -eq "ollama") { "qwen3:8b" } elseif ($Provider -eq "anthropic") { "claude-sonnet-4-5" } elseif ($Provider -eq "openai_compatible") { Current "MODEL_NAME" "model-name" } else { "gpt-6.1-sol" }
    Set-Value "MODEL_NAME" (Read-ModelSelection $Provider "Default model" (Current "MODEL_NAME" $DefaultModel))
    $DeepDefault = if ($Provider -in @("codex_cli", "openai")) { "gpt-6-astra" } else { Current "DEEP_MODEL_NAME" (Current "MODEL_NAME") }
    Set-Value "DEEP_MODEL_NAME" (Read-ModelSelection $Provider "Deep model" (Current "DEEP_MODEL_NAME" $DeepDefault))
    if ($Provider -eq "ollama") {
        Set-Value "MODEL_API_KEY" ""
        Set-Value "OLLAMA_BASE_URL" (Read-Plain "Ollama URL" (Current "OLLAMA_BASE_URL" "http://127.0.0.1:11434"))
    } elseif ($Provider -ne "codex_cli") {
        if ($Provider -eq "openai_compatible") {
            $BaseUrl = Read-ValidatedPlain "Compatible API base URL" (Current "MODEL_BASE_URL" "https://api.example.com/v1") {
                param($Candidate)
                $Parsed = $null
                [Uri]::TryCreate([string]$Candidate, [UriKind]::Absolute, [ref]$Parsed) -and $Parsed.Scheme -in @("http", "https")
            } "Enter an absolute http:// or https:// URL ending at the API version root."
            Set-Value "MODEL_BASE_URL" $BaseUrl.TrimEnd('/')
        }
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
    Write-Step 4 10 "Memory"
    $Mode = Read-Choice "Memory mode" @("standard", "semantic") "$(if (Current 'EMBEDDING_MODEL') { 'semantic' } else { 'standard' })"
    if ($Mode -eq "semantic") {
        Set-Value "EMBEDDING_MODEL" (Read-Plain "Embedding model" (Current "EMBEDDING_MODEL" "text-embedding-3-small"))
    } else { $Settings.Remove("EMBEDDING_MODEL") }
}
function Configure-Tools {
    Write-Step 5 10 "Browser and tools"
    $BrowserMode = Read-MappedChoice "Managed browser" @("enabled", "disabled") @("Enabled - browser actions remain approval-bound", "Disabled") "$(if (Current 'BROWSER_WS_ENDPOINT') { 'enabled' } else { 'disabled' })"
    if ($BrowserMode -eq "enabled") { Set-Value "BROWSER_WS_ENDPOINT" "local://chromium" }
    else { $Settings.Remove("BROWSER_WS_ENDPOINT") }
    $SearchMode = Read-MappedChoice "Private web search endpoint" @("keep", "configure", "disable") @("Keep current setting", "Configure a SearXNG HTTPS endpoint", "Disable dedicated search endpoint") "keep"
    if ($SearchMode -eq "configure") {
        $Endpoint = Read-ValidatedPlain "SearXNG URL" (Current "SEARXNG_BASE_URL" "https://search.example.com") {
            param($Candidate) [Uri]::IsWellFormedUriString([string]$Candidate, [UriKind]::Absolute) -and ([Uri]$Candidate).Scheme -eq "https"
        } "Enter a valid HTTPS URL."
        Set-Value "SEARXNG_BASE_URL" $Endpoint
    } elseif ($SearchMode -eq "disable") { $Settings.Remove("SEARXNG_BASE_URL") }
    Set-Value "LOG_LEVEL" (Read-MappedChoice "Diagnostic logging" @("warn", "info", "debug") @("Minimal", "Normal", "Detailed") (Current "LOG_LEVEL" "info"))
    Write-Host "Code execution stays isolated and approval-bound; native Windows never enables a hidden remote shell." -ForegroundColor DarkGray
}
function Configure-Channels {
    Write-Step 6 10 "Channels"
    $Configured = -not [string]::IsNullOrWhiteSpace((Current "TELEGRAM_BOT_TOKEN"))
    Write-Host "Telegram: $(if ($Configured) { 'configured' } else { 'disabled' })"
    $Choice = Read-MappedChoice "Telegram" @("keep", "configure", "disable") @("Keep current setting", "Connect or replace bot", "Disable Telegram") "keep"
    if ($Choice -eq "configure") {
        $TelegramToken = Read-Secret "Telegram bot token"
        if ($TelegramToken.Length -lt 20) { throw "Telegram bot token is invalid" }
        Set-Value "TELEGRAM_BOT_TOKEN" $TelegramToken
        Set-Value "TELEGRAM_WEBHOOK_SECRET" (New-RandomHex 32)
        Set-Value "TELEGRAM_POLLING_ENABLED" "true"
    } elseif ($Choice -eq "disable") {
        foreach ($Name in @("TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET", "TELEGRAM_POLLING_ENABLED")) { $Settings.Remove($Name) }
    }
    $DiscordConfigured = -not [string]::IsNullOrWhiteSpace((Current "DISCORD_BOT_TOKEN"))
    Write-Host "Discord: $(if ($DiscordConfigured) { 'configured (Gateway)' } else { 'disabled' })"
    $DiscordChoice = Read-MappedChoice "Discord" @("keep", "configure", "disable") @("Keep current setting", "Connect or replace bot", "Disable Discord") "keep"
    if ($DiscordChoice -eq "configure") {
        $DiscordToken = Read-Secret "Discord bot token"
        if ($DiscordToken.Length -lt 20) { throw "Discord bot token is invalid" }
        Set-Value "DISCORD_BOT_TOKEN" $DiscordToken
        Set-Value "DISCORD_GATEWAY_ENABLED" "true"
    } elseif ($DiscordChoice -eq "disable") {
        foreach ($Name in @("DISCORD_BOT_TOKEN", "DISCORD_GATEWAY_ENABLED")) { $Settings.Remove($Name) }
    }
    $SlackConfigured = (Current "SLACK_BOT_TOKEN") -and (Current "SLACK_APP_TOKEN")
    Write-Host "Slack: $(if ($SlackConfigured) { 'configured (Socket Mode)' } else { 'disabled' })"
    $SlackChoice = Read-MappedChoice "Slack" @("keep", "configure", "disable") @("Keep current setting", "Connect or replace app", "Disable Slack") "keep"
    if ($SlackChoice -eq "configure") {
        $SlackBotToken = Read-Secret "Slack bot token (xoxb-...)"
        $SlackAppToken = Read-Secret "Slack app token (xapp-...)"
        if (-not $SlackBotToken.StartsWith("xoxb-") -or -not $SlackAppToken.StartsWith("xapp-")) { throw "Slack tokens are invalid" }
        Set-Value "SLACK_BOT_TOKEN" $SlackBotToken
        Set-Value "SLACK_APP_TOKEN" $SlackAppToken
        Set-Value "SLACK_SOCKET_MODE_ENABLED" "true"
    } elseif ($SlackChoice -eq "disable") {
        foreach ($Name in @("SLACK_BOT_TOKEN", "SLACK_APP_TOKEN", "SLACK_SOCKET_MODE_ENABLED")) { $Settings.Remove($Name) }
    }
    $WhatsAppConfigured = (Current "WHATSAPP_ACCESS_TOKEN") -and (Current "WHATSAPP_PHONE_NUMBER_ID") -and (Current "WHATSAPP_APP_SECRET")
    Write-Host "WhatsApp: $(if ($WhatsAppConfigured) { 'configured (Cloud API)' } else { 'disabled' })"
    $WhatsAppChoice = Read-MappedChoice "WhatsApp" @("keep", "configure", "disable") @("Keep current setting", "Connect or replace Cloud API", "Disable WhatsApp") "keep"
    if ($WhatsAppChoice -eq "configure") {
        $AccessToken = Read-Secret "WhatsApp permanent access token"
        $PhoneNumberId = Read-ValidatedPlain "WhatsApp phone number ID" (Current "WHATSAPP_PHONE_NUMBER_ID") { param($Value) -not [string]::IsNullOrWhiteSpace([string]$Value) -and ([string]$Value).Length -le 64 } "Phone number ID is required."
        $VerifyToken = Read-Secret "WhatsApp webhook verify token (same value used in the provider dashboard)"
        $AppSecret = Read-Secret "WhatsApp app secret"
        if ($AccessToken.Length -lt 20 -or $VerifyToken.Length -lt 16 -or $AppSecret.Length -lt 16) { throw "WhatsApp credentials are invalid" }
        Set-Value "WHATSAPP_ACCESS_TOKEN" $AccessToken
        Set-Value "WHATSAPP_PHONE_NUMBER_ID" $PhoneNumberId
        Set-Value "WHATSAPP_VERIFY_TOKEN" $VerifyToken
        Set-Value "WHATSAPP_APP_SECRET" $AppSecret
        Set-Value "WHATSAPP_GRAPH_API_BASE_URL" (Read-ValidatedPlain "WhatsApp Graph API version root" (Current "WHATSAPP_GRAPH_API_BASE_URL" "https://graph.facebook.com/v23.0") { param($Value) [Uri]::IsWellFormedUriString([string]$Value, [UriKind]::Absolute) -and ([Uri]$Value).Scheme -eq "https" } "Enter a valid HTTPS URL.")
        Write-Host "Configure the public HTTPS callback as /channels/whatsapp/webhook." -ForegroundColor DarkGray
    } elseif ($WhatsAppChoice -eq "disable") {
        foreach ($Name in @("WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_VERIFY_TOKEN", "WHATSAPP_APP_SECRET", "WHATSAPP_GRAPH_API_BASE_URL")) { $Settings.Remove($Name) }
    }
}
function Configure-Integrations {
    Write-Step 7 10 "Integrations and skills"
    Write-Host "After restart, run: barlas integrations add PROVIDER LABEL" -ForegroundColor Cyan
    Write-Host "Supported providers: github, google_drive, gmail, google_calendar, mcp_http." -ForegroundColor DarkGray
    Write-Host "The token is entered with hidden input, encrypted in the vault, and can be tested with: barlas integrations test ID" -ForegroundColor DarkGray
    Write-Host "Built-in skills are ready. Signed catalog skills always require explicit trust and evaluation." -ForegroundColor DarkGray
}
function Configure-Automations {
    Write-Step 8 10 "Automations and limits"
    Set-Value "AGENT_MAX_STEPS" (Read-BoundedInteger "Maximum steps per run" (Current "AGENT_MAX_STEPS" "8") 1 12)
    Set-Value "AGENT_MAX_TOTAL_TOKENS" (Read-BoundedInteger "Maximum total tokens" (Current "AGENT_MAX_TOTAL_TOKENS" "50000") 1000 1000000)
    Set-Value "DAILY_CHAT_QUOTA" (Read-BoundedInteger "Daily chat quota" (Current "DAILY_CHAT_QUOTA" "500") 1 100000)
    Set-Value "DAILY_TOOL_QUOTA" (Read-BoundedInteger "Daily tool quota" (Current "DAILY_TOOL_QUOTA" "1000") 1 100000)
    Set-Value "DAILY_JOB_QUOTA" (Read-BoundedInteger "Daily job quota" (Current "DAILY_JOB_QUOTA" "100") 1 10000)
    Set-Value "JOB_WORKER_ENABLED" (Read-Choice "Scheduled jobs" @("true", "false") (Current "JOB_WORKER_ENABLED" "true"))
    Set-Value "AGENT_RUN_WORKER_ENABLED" (Read-Choice "Background agent runs" @("true", "false") (Current "AGENT_RUN_WORKER_ENABLED" "true"))
}
function Configure-Security {
    Write-Step 9 10 "Security"
    Write-Host "Gateway stays bound to 127.0.0.1. Secrets remain in the protected native configuration." -ForegroundColor DarkGray
    Set-Value "MAX_WORKSPACE_FILE_BYTES" (Read-BoundedInteger "Maximum workspace file bytes" (Current "MAX_WORKSPACE_FILE_BYTES" "2000000000") 1000000 10000000000000)
    Set-Value "SESSION_TTL_HOURS" (Read-BoundedInteger "Session lifetime in hours" (Current "SESSION_TTL_HOURS" "168") 1 720)
}
function Apply-Profile([string]$SelectedProfile) {
    if ($SelectedProfile -eq "complete") {
        Set-Value "AGENT_STYLE" (Current "AGENT_STYLE" "balanced")
        Set-Value "JOB_WORKER_ENABLED" "true"; Set-Value "AGENT_RUN_WORKER_ENABLED" "true"
    } elseif ($SelectedProfile -eq "quick") {
        Set-Value "AGENT_STYLE" (Current "AGENT_STYLE" "balanced")
        Set-Value "JOB_WORKER_ENABLED" "true"; Set-Value "AGENT_RUN_WORKER_ENABLED" "true"
    } elseif ($SelectedProfile -eq "private") {
        Set-Value "MODEL_PROVIDER" "ollama"; Set-Value "MODEL_API_KEY" ""; Set-Value "MEDIA_API_KEY" ""
        Set-Value "OLLAMA_BASE_URL" (Current "OLLAMA_BASE_URL" "http://127.0.0.1:11434")
        foreach ($Name in @("TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET", "TELEGRAM_POLLING_ENABLED", "DISCORD_BOT_TOKEN", "DISCORD_GATEWAY_ENABLED", "SLACK_BOT_TOKEN", "SLACK_APP_TOKEN", "SLACK_SOCKET_MODE_ENABLED", "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_VERIFY_TOKEN", "WHATSAPP_APP_SECRET", "WHATSAPP_GRAPH_API_BASE_URL")) { $Settings.Remove($Name) }
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
    if ((Current "MODEL_PROVIDER") -notin @("codex_cli", "openai", "anthropic", "ollama", "openai_compatible")) { $Problems += "MODEL_PROVIDER is invalid" }
    foreach ($Required in @("MODEL_NAME", "BARLAS_GATEWAY_TOKEN", "BARLAS_API_TOKEN", "CONNECTOR_VAULT_KEY")) {
        if ([string]::IsNullOrWhiteSpace((Current $Required))) { $Problems += "$Required is missing" }
    }
    if ((Current "MODEL_PROVIDER") -notin @("ollama", "codex_cli") -and [string]::IsNullOrWhiteSpace((Current "MODEL_API_KEY"))) { $Problems += "MODEL_API_KEY is missing" }
    if ((Current "MODEL_PROVIDER") -eq "openai_compatible" -and [string]::IsNullOrWhiteSpace((Current "MODEL_BASE_URL"))) { $Problems += "MODEL_BASE_URL is missing" }
    $WhatsAppFields = @((Current "WHATSAPP_ACCESS_TOKEN"), (Current "WHATSAPP_PHONE_NUMBER_ID"), (Current "WHATSAPP_VERIFY_TOKEN"), (Current "WHATSAPP_APP_SECRET"))
    $WhatsAppConfigured = @($WhatsAppFields | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }).Count
    if ($WhatsAppConfigured -ne 0 -and $WhatsAppConfigured -ne 4) { $Problems += "All WhatsApp settings must be configured together" }
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
    if ((Current "MODEL_PROVIDER") -eq "openai_compatible") { Write-Output "Compatible API URL: $(Current 'MODEL_BASE_URL')" }
    Write-Output "Vision model: $(Current 'VISION_MODEL' 'disabled')"
    Write-Output "Authentication: $(if ((Current 'MODEL_PROVIDER') -eq 'codex_cli') { 'OpenAI account session' } elseif ((Current 'MODEL_PROVIDER') -eq 'ollama') { 'local, no key' } elseif (Current 'MODEL_API_KEY') { 'API key configured' } else { 'missing' })"
    if ((Current "MODEL_PROVIDER") -eq "codex_cli") {
        & (Join-Path $RootDir "scripts\model-auth-native.ps1") -Action status
    }
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
    Write-Output "WhatsApp: $(if ((Current 'WHATSAPP_ACCESS_TOKEN') -and (Current 'WHATSAPP_PHONE_NUMBER_ID')) { 'configured (signed webhook)' } else { 'disabled' })"
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

Write-Host "`n  ●  ●  " -ForegroundColor Red -NoNewline
Write-Host "BARLAS" -ForegroundColor White
Write-Host "    ●    " -ForegroundColor Red -NoNewline
Write-Host "AI AGENT" -ForegroundColor DarkGray
Write-Host "  THINK AHEAD. " -ForegroundColor Red -NoNewline
Write-Host "ACT BEYOND." -ForegroundColor White
Write-Host "  Personal AI setup" -ForegroundColor DarkGray
Write-Host "  Arrows move · type filters · Enter selects · secrets stay hidden." -ForegroundColor DarkGray

if ($Section -eq "all") {
    if (-not $Profile) {
        Write-Host "`nSetup profiles" -ForegroundColor Cyan
        Write-Host "  complete   Every important setting, guided step by step"
        Write-Host "  quick      Essential choices, sensible defaults"
        Write-Host "  private    Local Ollama, no cloud key, no external channels"
        Write-Host "  developer  Advanced limits, tools and diagnostics"
        Write-Host "  server     Higher worker limits with hardened checks"
        Write-Host "  import     Import a previous Barlas configuration"
        $Profile = Read-MappedChoice "Setup depth" @("complete", "quick", "private", "developer", "server", "import") @("Complete - all important settings", "Quick - essentials only", "Private - local models and no external channels", "Developer - extended tools and limits", "Server - higher worker limits", "Import - existing Barlas configuration") "complete"
    }
    if ($Profile -eq "import") { Import-BarlasConfig } else { Apply-Profile $Profile }
}

$Sections = if ($Section -eq "all") {
    if ($Profile -eq "quick") { @("general", "identity", "models", "channels", "security") }
    elseif ($Profile -eq "import") { @("security") }
    else { @("general", "identity", "models", "memory", "tools", "channels", "integrations", "automations", "security") }
} elseif ($Section -eq "agent") { @("identity", "automations") } else { @($Section) }

if ("general" -in $Sections) { Configure-General }
if ("identity" -in $Sections) { Configure-Identity }
if ("models" -in $Sections) { Configure-Models }
if ("memory" -in $Sections) { Configure-Memory }
if ("tools" -in $Sections) { Configure-Tools }
if ("channels" -in $Sections) { Configure-Channels }
if ("integrations" -in $Sections) { Configure-Integrations }
if ("automations" -in $Sections) { Configure-Automations }
if ("security" -in $Sections) { Configure-Security }
Save-Settings
Write-Step 10 10 "Review"
Write-Host "  Profile:       $(if ($Profile) { $Profile } else { 'custom' })"
Write-Host "  Agent:         $(Current 'AGENT_NAME' 'Barlas') ($(Current 'AGENT_STYLE' 'balanced'))"
Write-Host "  Model:         $(Current 'MODEL_PROVIDER') / $(Current 'MODEL_NAME')"
Write-Host "  Memory:        $(if (Current 'EMBEDDING_MODEL') { 'semantic' } else { 'standard' })"
Write-Host "  Telegram:      $(if (Current 'TELEGRAM_BOT_TOKEN') { 'configured' } else { 'disabled' })"
Write-Host "  Discord:       $(if (Current 'DISCORD_BOT_TOKEN') { 'configured' } else { 'disabled' })"
Write-Host "  Slack:         $(if ((Current 'SLACK_BOT_TOKEN') -and (Current 'SLACK_APP_TOKEN')) { 'configured' } else { 'disabled' })"
Write-Host "  WhatsApp:      $(if ((Current 'WHATSAPP_ACCESS_TOKEN') -and (Current 'WHATSAPP_PHONE_NUMBER_ID')) { 'configured' } else { 'disabled' })"
Write-Host "`n[OK] Configuration saved securely" -ForegroundColor Green
Write-Host "The gateway will restart and run final diagnostics." -ForegroundColor DarkGray
