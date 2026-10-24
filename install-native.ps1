[CmdletBinding()]
param([switch]$NonInteractive)

$ErrorActionPreference = "Stop"
$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BarlasHome = Join-Path $env:LOCALAPPDATA "Barlas"
$EnvFile = Join-Path $RootDir "deploy\native.env"
$SupportedLanguageCodes = @("tr", "az", "azb", "tk", "gag", "qxq", "kmz", "klj", "uz", "ug", "ili", "slr", "ybe", "kk", "ky", "kaa", "nog", "tt", "ba", "crh", "kum", "krc", "kdr", "uum", "cv", "sah", "dlg", "tyv", "kim", "alt", "kjh", "cjs", "clw", "fuy", "sty", "mn", "ru", "en")
$SupportedLanguageNames = @("Türkçe", "Azərbaycanca", "تۆرکجه", "Türkmençe", "Gagauzça", "قشقایی دیلی", "ترکی خراسانی", "خلجی", "O‘zbekcha", "ئۇيغۇرچە", "ئىلى تۈركى", "Salırça", "Yughur", "Қазақша", "Кыргызча", "Qaraqalpaqsha", "Ногайша", "Татарча", "Башҡортса", "Qırımtatarca", "Къумукъча", "Къарачай-малкъар тил", "Karaj tili", "Урум тили", "Чӑвашла", "Саха тыла", "Дулҕан тыла", "Тыва дыл", "Тоъфа дыл", "Алтай тил", "Хакас тілі", "Шор тили", "Ӧс тили", "Fuyu Gïrgïs", "Себер татар теле", "Монгол хэл", "Русский", "English")

function Read-Value([string]$Name, [string]$Label, [string]$Default = "", [switch]$Secret) {
    $Existing = [Environment]::GetEnvironmentVariable($Name)
    if (-not [string]::IsNullOrWhiteSpace($Existing)) { return $Existing }
    if ($NonInteractive) { return $Default }
    $Prompt = if ($Default) { "$Label [$Default]" } else { $Label }
    if ($Secret) {
        $Secure = Read-Host $Prompt -AsSecureString
        $Pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
        try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($Pointer) }
        finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($Pointer) }
    }
    $Value = Read-Host $Prompt
    if ([string]::IsNullOrWhiteSpace($Value)) { return $Default }
    return $Value
}

function Resolve-MenuValue([string]$InputValue, [string[]]$Values, [hashtable]$Aliases) {
    if ([string]::IsNullOrWhiteSpace($InputValue)) { return "" }
    $Normalized = $InputValue.Trim().ToLowerInvariant()
    $Exact = [Array]::IndexOf($Values, $Normalized)
    if ($Exact -ge 0) { return $Values[$Exact] }
    if ($Aliases -and $Aliases.ContainsKey($Normalized)) {
        $AliasValue = ([string]$Aliases[$Normalized]).ToLowerInvariant()
        if ($AliasValue -in $Values) { return $AliasValue }
    }
    return ""
}

function Read-NumberedMenu([string[]]$Values, [string[]]$Labels, [string]$Default, [hashtable]$Aliases) {
    for ($Index = 0; $Index -lt $Values.Count; $Index++) {
        $DefaultMarker = if ($Values[$Index] -eq $Default) { " (default)" } else { "" }
        Write-Host "  [$($Index + 1)] $($Labels[$Index])$DefaultMarker"
    }
    while ($true) {
        $DefaultNumber = 1 + [Array]::IndexOf($Values, $Default)
        $Answer = (Read-Host "Choose 1-$($Values.Count) [$DefaultNumber]").Trim()
        if (-not $Answer) { return $Default }
        $Number = 0
        if ([int]::TryParse($Answer, [ref]$Number)) {
            $Selected = $Number - 1
            if ($Selected -ge 0 -and $Selected -lt $Values.Count) { return $Values[$Selected] }
        }
        $Resolved = Resolve-MenuValue $Answer $Values $Aliases
        if ($Resolved) { return $Resolved }
        Write-Host "That option is not available. Choose a number from 1 to $($Values.Count)." -ForegroundColor Yellow
    }
}

function Read-ArrowMenu([string[]]$Values, [string[]]$Labels, [string]$Default) {
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
            $Help = "  Up/Down move | PgUp/PgDn | Home/End | Enter select | Esc default"
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

function Read-MenuChoice([string]$EnvironmentName, [string]$Title, [string[]]$Values, [string[]]$Labels, [string]$Default, [hashtable]$Aliases = @{}) {
    if ($Values.Count -ne $Labels.Count) { throw "Invalid setup menu" }
    if ($Default -notin $Values) { $Default = $Values[0] }
    $EnvironmentValue = if ($EnvironmentName) { [Environment]::GetEnvironmentVariable($EnvironmentName) } else { "" }
    if (-not [string]::IsNullOrWhiteSpace($EnvironmentValue)) {
        $ResolvedEnvironment = Resolve-MenuValue $EnvironmentValue $Values $Aliases
        if ($ResolvedEnvironment) { return $ResolvedEnvironment }
        if ($NonInteractive) { throw "$EnvironmentName has an unsupported value" }
        Write-Host "Ignoring unsupported $EnvironmentName value and asking again." -ForegroundColor Yellow
    }
    if ($NonInteractive) { return $Default }
    Write-Host ""
    Write-Host $Title -ForegroundColor Cyan
    $ArrowChoice = Read-ArrowMenu $Values $Labels $Default
    if ($ArrowChoice) { return $ArrowChoice }
    return Read-NumberedMenu $Values $Labels $Default $Aliases
}

function Read-ValidatedValue([string]$Name, [string]$Label, [string]$Default, [scriptblock]$Validate, [string]$ErrorMessage, [switch]$Secret) {
    $EnvironmentValue = [Environment]::GetEnvironmentVariable($Name)
    if (-not [string]::IsNullOrWhiteSpace($EnvironmentValue)) {
        if (& $Validate $EnvironmentValue) { return $EnvironmentValue }
        if ($NonInteractive) { throw "$Name is invalid: $ErrorMessage" }
        Write-Host "Ignoring invalid $Name value and asking again." -ForegroundColor Yellow
    }
    if ($NonInteractive) {
        if (& $Validate $Default) { return $Default }
        throw "$Name is invalid: $ErrorMessage"
    }
    while ($true) {
        $Prompt = if ($Secret) { $Label } elseif ($Default) { "$Label [$Default]" } else { $Label }
        if ($Secret) {
            $Secure = Read-Host $Prompt -AsSecureString
            $Pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
            try { $Value = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($Pointer) }
            finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($Pointer) }
        } else {
            $Value = Read-Host $Prompt
        }
        if ([string]::IsNullOrWhiteSpace($Value)) { $Value = $Default }
        if (& $Validate $Value) { return $Value }
        Write-Host $ErrorMessage -ForegroundColor Yellow
    }
}

function Read-OwnerLanguage {
    $EnvironmentValue = [Environment]::GetEnvironmentVariable("OWNER_LANGUAGE")
    if (-not [string]::IsNullOrWhiteSpace($EnvironmentValue)) {
        $NormalizedLanguage = $EnvironmentValue.Trim().ToLowerInvariant()
        if ($NormalizedLanguage -in $SupportedLanguageCodes) { return $NormalizedLanguage }
        if ($NonInteractive) { throw "OWNER_LANGUAGE is unsupported" }
        Write-Host "Ignoring unsupported OWNER_LANGUAGE value and asking again." -ForegroundColor Yellow
    }
    if ($NonInteractive) { return "en" }
    return Read-MenuChoice "" "Tilni tanlang / Выберите язык / Choose language" $SupportedLanguageCodes $SupportedLanguageNames "ru"
}

function Read-ModelSelection([string]$Provider, [string]$Title, [string]$Default) {
    if ($NonInteractive) { return $Default }
    if ($Provider -eq "codex_cli" -or $Provider -eq "openai") {
        $Values = @("gpt-6-astra", "gpt-6.1-sol", "gpt-6-sol", "gpt-6-luna", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5", "gpt-5.5-pro", "gpt-5.4", "gpt-5.4-pro", "gpt-5.4-mini", "gpt-5.4-nano", "custom")
        $Labels = @("GPT-6 Astra - maximum capability", "GPT-6.1 Sol - powerful and efficient", "GPT-6 Sol - coding and agents", "GPT-6 Luna - fast and economical", "GPT-5.6 Sol", "GPT-5.6 Terra", "GPT-5.6 Luna", "GPT-5.5", "GPT-5.5 Pro", "GPT-5.4", "GPT-5.4 Pro", "GPT-5.4 Mini", "GPT-5.4 Nano", "Any other current or future model ID")
    } elseif ($Provider -eq "anthropic") {
        $Values = @("claude-sonnet-4-5", "claude-haiku-4-5", "claude-opus-4-1", "custom")
        $Labels = @("Claude Sonnet 4.5", "Claude Haiku 4.5", "Claude Opus 4.1", "Any other current or future model ID")
    } elseif ($Provider -eq "ollama") {
        $Values = @("qwen3:8b", "qwen3:14b", "qwen3:30b", "gpt-oss:20b", "gpt-oss:120b", "llama3.3", "deepseek-r1", "custom")
        $Labels = @("Qwen 3 8B - recommended for laptops", "Qwen 3 14B", "Qwen 3 30B", "GPT-OSS 20B", "GPT-OSS 120B", "Llama 3.3", "DeepSeek R1", "Any installed Ollama model ID")
    } else {
        $Values = @("custom")
        $Labels = @("Enter the exact model ID supported by the endpoint")
    }
    $MenuDefault = if ($Default -in $Values) { $Default } else { "custom" }
    $Selected = Read-MenuChoice "" $Title $Values $Labels $MenuDefault
    if ($Selected -ne "custom") { return $Selected }
    return Read-ValidatedValue "" "Model ID" $Default {
        param($Value) -not [string]::IsNullOrWhiteSpace([string]$Value) -and -not ([string]$Value).Contains("`r") -and -not ([string]$Value).Contains("`n")
    } "Model ID cannot be blank."
}

function New-RandomHex([int]$Bytes) {
    $Buffer = New-Object byte[] $Bytes
    ([Security.Cryptography.RandomNumberGenerator]::Create()).GetBytes($Buffer)
    return -join ($Buffer | ForEach-Object { $_.ToString("x2") })
}

function New-RandomBase64([int]$Bytes) {
    $Buffer = New-Object byte[] $Bytes
    ([Security.Cryptography.RandomNumberGenerator]::Create()).GetBytes($Buffer)
    return [Convert]::ToBase64String($Buffer)
}

function ConvertTo-EnvValue([string]$Value) { return "'" + $Value.Replace("'", "\'") + "'" }

function Protect-SecretFile([string]$Path) {
    $UserSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $PreviousPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        & icacls.exe $Path "/inheritance:r" "/grant:r" "*${UserSid}:(F)" "*S-1-5-18:(F)" *> $null
        $AclExitCode = $LASTEXITCODE
    } finally { $ErrorActionPreference = $PreviousPreference }
    if ($AclExitCode -ne 0) { throw "Unable to protect the Barlas configuration file for the current Windows user." }
}

if (Test-Path -LiteralPath $EnvFile -PathType Leaf) {
    Protect-SecretFile $EnvFile
    Write-Host "[OK] Using existing protected native configuration" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "  O  O  " -ForegroundColor Red -NoNewline
    Write-Host "BARLAS" -ForegroundColor White
    Write-Host "    O    " -ForegroundColor Red -NoNewline
    Write-Host "AI AGENT" -ForegroundColor DarkGray
    Write-Host "  THINK AHEAD. " -ForegroundColor Red -NoNewline
    Write-Host "ACT BEYOND." -ForegroundColor White
    Write-Host "  Use arrows to move, type to filter, and press Enter to select." -ForegroundColor DarkGray
    # Language is the first setup decision and is persisted for every later surface.
    $OwnerLanguage = Read-OwnerLanguage
    $LanguageIndex = [Array]::IndexOf($SupportedLanguageCodes, $OwnerLanguage)
    Write-Host "  $($SupportedLanguageNames[$LanguageIndex]) [$OwnerLanguage]" -ForegroundColor Green
    $SetupMode = Read-MenuChoice "BARLAS_SETUP_MODE" "Setup experience" @("complete", "quick") @("Complete - configure the full agent now", "Quick - essential settings with safe defaults") "complete"
    $Port = Read-ValidatedValue "BARLAS_HTTP_PORT" "Local web port" "17840" {
        param($Value)
        $Parsed = 0
        [int]::TryParse([string]$Value, [ref]$Parsed) -and $Parsed -ge 1024 -and $Parsed -le 65535
    } "Enter a port between 1024 and 65535."
    $OwnerEmail = Read-ValidatedValue "OWNER_EMAIL" "First owner email (local identity only)" "owner@barlas.local" {
        param($Value) [string]$Value -match '^[^\s@]+@[^\s@]+\.[^\s@]+$'
    } "Enter a valid email address, for example owner@barlas.local."
    $OwnerDisplayName = Read-ValidatedValue "OWNER_DISPLAY_NAME" "First owner display name" "Barlas Owner" {
        param($Value) -not [string]::IsNullOrWhiteSpace([string]$Value) -and ([string]$Value).Length -le 80
    } "Enter a display name up to 80 characters."
    $ProviderAliases = @{ "openai account" = "codex_cli"; "openai oauth" = "codex_cli"; "cli oauth" = "codex_cli"; "openai api" = "openai"; "openai codex" = "codex_cli"; "anthropic api" = "anthropic"; "local ollama" = "ollama"; "compatible" = "openai_compatible"; "custom api" = "openai_compatible" }
    $ModelProvider = Read-MenuChoice "MODEL_PROVIDER" "Model access" @("codex_cli", "openai", "anthropic", "ollama", "openai_compatible") @("OpenAI account - browser sign-in, no API key", "OpenAI API - usage-based key", "Anthropic API - usage-based key", "Ollama - local and private", "Compatible API - hosted or self-hosted endpoint") "codex_cli" $ProviderAliases
    if ($ModelProvider -eq "codex_cli") {
        $AuthState = & (Join-Path $RootDir "scripts\model-auth-native.ps1") -Action status -Quiet
        if ($AuthState -ne "connected") {
            if ($NonInteractive) {
                Write-Host "[INFO] OpenAI account sign-in is deferred until Barlas first opens." -ForegroundColor Cyan
            } else {
                & (Join-Path $RootDir "scripts\model-auth-native.ps1") -Action login
            }
        }
    }
    $DefaultModel = if ($ModelProvider -eq "ollama") { "qwen3:8b" } elseif ($ModelProvider -eq "anthropic") { "claude-sonnet-4-5" } elseif ($ModelProvider -eq "openai_compatible") { "model-name" } else { "gpt-6.1-sol" }
    $EnvironmentModel = [Environment]::GetEnvironmentVariable("MODEL_NAME")
    $ModelName = if ($EnvironmentModel) { $EnvironmentModel } else { Read-ModelSelection $ModelProvider "Default model" $DefaultModel }
    $EnvironmentDeepModel = [Environment]::GetEnvironmentVariable("DEEP_MODEL_NAME")
    $DeepModelName = if ($EnvironmentDeepModel) { $EnvironmentDeepModel } else { Read-ModelSelection $ModelProvider "Deep model" $(if ($ModelProvider -in @("codex_cli", "openai")) { "gpt-6-astra" } else { $ModelName }) }
    $MediaApiKey = ""
    if ($ModelProvider -ne "openai") {
        $MediaApiKey = Read-Value "MEDIA_API_KEY" "Optional OpenAI key for media features" "" -Secret
        $VisionModel = if ($MediaApiKey) { Read-Value "VISION_MODEL" "OpenAI vision/PDF model name" "gpt-4.1-mini" } else { "" }
    } else { $VisionModel = Read-Value "VISION_MODEL" "Vision/PDF model name" $ModelName }
    $ModelApiKey = if ($ModelProvider -in @("ollama", "codex_cli")) { "" } else {
        Read-ValidatedValue "MODEL_API_KEY" "Dedicated model API key" "" {
            param($Value) -not [string]::IsNullOrWhiteSpace([string]$Value) -and -not ([string]$Value).Contains("`r") -and -not ([string]$Value).Contains("`n")
        } "An API key is required for this provider." -Secret
    }
    $OllamaBaseUrl = if ($ModelProvider -eq "ollama") { Read-Value "OLLAMA_BASE_URL" "Ollama URL" "http://127.0.0.1:11434" } else { "http://127.0.0.1:11434" }
    $ModelBaseUrl = if ($ModelProvider -eq "openai_compatible") {
        Read-ValidatedValue "MODEL_BASE_URL" "Compatible API base URL" "https://api.example.com/v1" {
            param($Value)
            $Parsed = $null
            [Uri]::TryCreate([string]$Value, [UriKind]::Absolute, [ref]$Parsed) -and $Parsed.Scheme -in @("http", "https")
        } "Enter an absolute http:// or https:// URL ending at the API version root."
    } else { "" }
    $TelegramBotToken = Read-Value "TELEGRAM_BOT_TOKEN" "Dedicated Telegram bot token; blank disables Telegram" "" -Secret

    $AgentName = "Barlas"; $AgentStyle = "balanced"; $AgentInstructions = ""
    $EmbeddingModel = ""; $DefaultVoice = "alloy"; $BrowserEndpoint = "local://chromium"
    $DiscordBotToken = ""; $SlackBotToken = ""; $SlackAppToken = ""
    $WhatsAppAccessToken = ""; $WhatsAppPhoneNumberId = ""; $WhatsAppVerifyToken = ""; $WhatsAppAppSecret = ""
    $AgentMaxSteps = "8"; $AgentMaxTokens = "50000"; $DailyChatQuota = "500"; $DailyToolQuota = "1000"; $DailyJobQuota = "100"
    $MaxWorkspaceFileBytes = "2000000000"; $SessionTtlHours = "168"; $LogLevel = "info"
    if ($SetupMode -eq "complete") {
        Write-Host "`nAGENT PERSONALITY" -ForegroundColor White
        $AgentName = Read-ValidatedValue "AGENT_NAME" "Agent name" "Barlas" {
            param($Value) -not [string]::IsNullOrWhiteSpace([string]$Value) -and ([string]$Value).Length -le 80
        } "Enter a name up to 80 characters."
        $AgentStyle = Read-MenuChoice "AGENT_STYLE" "Conversation style" @("balanced", "concise", "warm", "analytical", "creative") @("Balanced", "Concise", "Warm", "Analytical", "Creative") "balanced"
        $AgentInstructions = Read-Value "AGENT_INSTRUCTIONS" "Personal instructions; blank uses the standard behavior" ""

        Write-Host "`nMEMORY, TOOLS AND VOICE" -ForegroundColor White
        $MemoryMode = Read-MenuChoice "BARLAS_MEMORY_MODE" "Memory" @("standard", "semantic") @("Standard - durable notes and conversation history", "Semantic - also search memories by meaning") "standard"
        if ($MemoryMode -eq "semantic") {
            if ($ModelProvider -eq "openai" -or $MediaApiKey) { $EmbeddingModel = Read-Value "EMBEDDING_MODEL" "Embedding model" "text-embedding-3-small" }
            else { Write-Host "Semantic embeddings need an OpenAI API key; standard memory remains enabled." -ForegroundColor Yellow }
        }
        $BrowserMode = Read-MenuChoice "BARLAS_BROWSER_MODE" "Managed browser" @("enabled", "disabled") @("Enabled - Barlas may browse with approvals", "Disabled") "enabled"
        if ($BrowserMode -eq "disabled") { $BrowserEndpoint = "" }
        $DefaultVoice = Read-MenuChoice "DEFAULT_SPEECH_VOICE" "Default voice" @("alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse") @("Alloy", "Ash", "Ballad", "Coral", "Echo", "Fable", "Nova", "Onyx", "Sage", "Shimmer", "Verse") "alloy"

        Write-Host "`nOPTIONAL CHANNELS" -ForegroundColor White
        $DiscordChoice = Read-MenuChoice "BARLAS_DISCORD_SETUP" "Discord" @("skip", "configure") @("Skip for now", "Connect a bot through Gateway") "skip"
        if ($DiscordChoice -eq "configure") { $DiscordBotToken = Read-Value "DISCORD_BOT_TOKEN" "Discord bot token" "" -Secret }
        $SlackChoice = Read-MenuChoice "BARLAS_SLACK_SETUP" "Slack" @("skip", "configure") @("Skip for now", "Connect through Socket Mode") "skip"
        if ($SlackChoice -eq "configure") {
            $SlackBotToken = Read-Value "SLACK_BOT_TOKEN" "Slack bot token (xoxb-...)" "" -Secret
            $SlackAppToken = Read-Value "SLACK_APP_TOKEN" "Slack app token (xapp-...)" "" -Secret
        }
        $WhatsAppChoice = Read-MenuChoice "BARLAS_WHATSAPP_SETUP" "WhatsApp" @("skip", "configure") @("Skip for now", "Connect through Cloud API signed webhooks") "skip"
        if ($WhatsAppChoice -eq "configure") {
            $WhatsAppAccessToken = Read-Value "WHATSAPP_ACCESS_TOKEN" "WhatsApp permanent access token" "" -Secret
            $WhatsAppPhoneNumberId = Read-Value "WHATSAPP_PHONE_NUMBER_ID" "WhatsApp phone number ID" ""
            $WhatsAppVerifyToken = Read-Value "WHATSAPP_VERIFY_TOKEN" "Webhook verify token (same value used in the provider dashboard)" "" -Secret
            $WhatsAppAppSecret = Read-Value "WHATSAPP_APP_SECRET" "WhatsApp app secret" "" -Secret
            if ($WhatsAppAccessToken.Length -lt 20 -or [string]::IsNullOrWhiteSpace($WhatsAppPhoneNumberId) -or $WhatsAppVerifyToken.Length -lt 16 -or $WhatsAppAppSecret.Length -lt 16) { throw "WhatsApp credentials are invalid" }
        }

        Write-Host "`nAUTOMATION AND SAFETY" -ForegroundColor White
        $Autonomy = Read-MenuChoice "BARLAS_AUTONOMY" "Autonomy limits" @("safe", "balanced", "extended") @("Safe - 6 steps / 30k tokens", "Balanced - 8 steps / 50k tokens", "Extended - 12 steps / 100k tokens") "balanced"
        if ($Autonomy -eq "safe") { $AgentMaxSteps = "6"; $AgentMaxTokens = "30000" }
        elseif ($Autonomy -eq "extended") { $AgentMaxSteps = "12"; $AgentMaxTokens = "100000" }
        $Quota = Read-MenuChoice "BARLAS_USAGE_PROFILE" "Daily usage" @("personal", "power") @("Personal - 500 chats / 1,000 tools / 100 jobs", "Power - 5,000 chats / 10,000 tools / 1,000 jobs") "personal"
        if ($Quota -eq "power") { $DailyChatQuota = "5000"; $DailyToolQuota = "10000"; $DailyJobQuota = "1000" }
        $FileLimit = Read-MenuChoice "BARLAS_FILE_PROFILE" "Maximum file size" @("2gb", "10gb") @("2 GB - recommended", "10 GB - for large local workspaces") "2gb"
        if ($FileLimit -eq "10gb") { $MaxWorkspaceFileBytes = "10000000000" }
        $LogLevel = Read-MenuChoice "LOG_LEVEL" "Diagnostic logging" @("warn", "info", "debug") @("Minimal", "Normal", "Detailed") "info"
    }

    $Settings = [ordered]@{
        APP_ENV = "production"; APP_NAME = "Barlas AI Agent"; BARLAS_INSTALL_MODE = "native"
        HOST = "127.0.0.1"; PORT = $Port; BARLAS_HTTP_PORT = $Port
        DATABASE_URL = "postgresql://native-runtime"; BARLAS_NATIVE_ROOT = $RootDir
        BARLAS_NATIVE_DATA = (Join-Path $BarlasHome "data"); BARLAS_NATIVE_DATABASE_PORT = "17841"
        BARLAS_API_TOKEN = New-RandomHex 32; BARLAS_GATEWAY_TOKEN = New-RandomHex 32
        MODEL_PROVIDER = $ModelProvider; MODEL_NAME = $ModelName; MODEL_API_KEY = $ModelApiKey; MODEL_BASE_URL = $ModelBaseUrl; OLLAMA_BASE_URL = $OllamaBaseUrl
        MEDIA_API_KEY = $MediaApiKey; VISION_MODEL = $VisionModel; TRANSCRIPTION_MODEL = "gpt-4o-mini-transcribe"
        SPEECH_MODEL = "gpt-4o-mini-tts"; DEFAULT_SPEECH_VOICE = $DefaultVoice; EMBEDDING_MODEL = $EmbeddingModel; DEEP_MODEL_NAME = $DeepModelName
        CONNECTOR_VAULT_KEY = New-RandomBase64 32; CONNECTOR_VAULT_KEY_VERSION = "1"
        OWNER_EMAIL = $OwnerEmail; OWNER_DISPLAY_NAME = $OwnerDisplayName; OWNER_LANGUAGE = $OwnerLanguage
        WORKSPACE_ROOT = (Join-Path $BarlasHome "data\workspaces"); WEB_ROOT = (Join-Path $RootDir "web")
        BROWSER_WS_ENDPOINT = $BrowserEndpoint; JOB_WORKER_ENABLED = "true"; AGENT_RUN_WORKER_ENABLED = "true"
        AGENT_RUN_WORKER_POLL_MS = "1000"; AGENT_RUN_WORKER_BATCH_SIZE = "2"; AGENT_RUN_LEASE_SECONDS = "300"
        AGENT_NAME = $AgentName; AGENT_STYLE = $AgentStyle; AGENT_INSTRUCTIONS = $AgentInstructions
        AGENT_MAX_STEPS = $AgentMaxSteps; AGENT_MAX_TOTAL_TOKENS = $AgentMaxTokens; AGENT_MAX_OUTPUT_TOKENS_PER_STEP = "4096"
        DAILY_CHAT_QUOTA = $DailyChatQuota; DAILY_TOOL_QUOTA = $DailyToolQuota; DAILY_JOB_QUOTA = $DailyJobQuota
        MAX_WORKSPACE_FILE_BYTES = $MaxWorkspaceFileBytes; SESSION_TTL_HOURS = $SessionTtlHours; LOG_LEVEL = $LogLevel
    }
    if ($TelegramBotToken) {
        $Settings["TELEGRAM_BOT_TOKEN"] = $TelegramBotToken
        $Settings["TELEGRAM_WEBHOOK_SECRET"] = New-RandomHex 32
        $Settings["TELEGRAM_POLLING_ENABLED"] = "true"
    }
    if ($DiscordBotToken) { $Settings["DISCORD_BOT_TOKEN"] = $DiscordBotToken; $Settings["DISCORD_GATEWAY_ENABLED"] = "true" }
    if ($SlackBotToken -and $SlackAppToken) {
        $Settings["SLACK_BOT_TOKEN"] = $SlackBotToken; $Settings["SLACK_APP_TOKEN"] = $SlackAppToken; $Settings["SLACK_SOCKET_MODE_ENABLED"] = "true"
    }
    if ($WhatsAppAccessToken -and $WhatsAppPhoneNumberId -and $WhatsAppVerifyToken -and $WhatsAppAppSecret) {
        $Settings["WHATSAPP_ACCESS_TOKEN"] = $WhatsAppAccessToken
        $Settings["WHATSAPP_PHONE_NUMBER_ID"] = $WhatsAppPhoneNumberId
        $Settings["WHATSAPP_VERIFY_TOKEN"] = $WhatsAppVerifyToken
        $Settings["WHATSAPP_APP_SECRET"] = $WhatsAppAppSecret
        $Settings["WHATSAPP_GRAPH_API_BASE_URL"] = "https://graph.facebook.com/v23.0"
    }
    foreach ($Pair in $Settings.GetEnumerator()) {
        if (([string]$Pair.Value).Contains("`r") -or ([string]$Pair.Value).Contains("`n")) { throw "$($Pair.Key) must be a single line" }
    }
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $EnvFile), (Join-Path $BarlasHome "data") | Out-Null
    $Temporary = "$EnvFile.tmp.$([Guid]::NewGuid().ToString('N'))"
    try {
        $Lines = foreach ($Pair in $Settings.GetEnumerator()) { "$($Pair.Key)=$(ConvertTo-EnvValue ([string]$Pair.Value))" }
        [IO.File]::WriteAllLines($Temporary, $Lines, (New-Object Text.UTF8Encoding($false)))
        Protect-SecretFile $Temporary
        Move-Item -LiteralPath $Temporary -Destination $EnvFile
        Protect-SecretFile $EnvFile
    } finally { if (Test-Path -LiteralPath $Temporary) { Remove-Item -LiteralPath $Temporary -Force } }
    Write-Host "[OK] Protected native configuration created" -ForegroundColor Green
}

function Read-NativeSetting([string]$Name) {
    $Prefix = "$Name="
    foreach ($Line in [IO.File]::ReadAllLines($EnvFile)) {
        if ($Line.StartsWith($Prefix, [StringComparison]::Ordinal)) {
            $Raw = $Line.Substring($Prefix.Length)
            if ($Raw.Length -ge 2 -and $Raw[0] -eq "'" -and $Raw[$Raw.Length - 1] -eq "'") { return $Raw.Substring(1, $Raw.Length - 2).Replace("\'", "'") }
            return $Raw.Trim('"')
        }
    }
    return ""
}

function Ensure-Ollama {
    if ((Read-NativeSetting "MODEL_PROVIDER") -ne "ollama") { return }
    $BaseUrl = Read-NativeSetting "OLLAMA_BASE_URL"
    if (-not $BaseUrl) { $BaseUrl = "http://127.0.0.1:11434" }
    $Model = Read-NativeSetting "MODEL_NAME"
    $OllamaExe = (Get-Command ollama.exe -ErrorAction SilentlyContinue).Source
    if (-not $OllamaExe) {
        $OllamaExe = Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama.exe"
        if (-not (Test-Path -LiteralPath $OllamaExe -PathType Leaf)) {
            $Winget = Get-Command winget.exe -ErrorAction SilentlyContinue
            if (-not $Winget) { throw "Ollama is not installed and winget is unavailable. Install Ollama from https://ollama.com/download/windows and run Barlas again." }
            Write-Host "Installing the free local Ollama runtime..." -ForegroundColor Cyan
            & $Winget.Source install --id Ollama.Ollama -e --accept-package-agreements --accept-source-agreements
            if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $OllamaExe -PathType Leaf)) { throw "Ollama installation did not complete. Install it from https://ollama.com/download/windows and run Barlas again." }
        }
    }
    try { Invoke-RestMethod -Uri "$($BaseUrl.TrimEnd('/'))/api/tags" -TimeoutSec 3 | Out-Null }
    catch {
        Start-Process -FilePath $OllamaExe -ArgumentList "serve" -WindowStyle Hidden
        $Ready = $false
        for ($Attempt = 0; $Attempt -lt 30; $Attempt++) {
            Start-Sleep -Seconds 2
            try { Invoke-RestMethod -Uri "$($BaseUrl.TrimEnd('/'))/api/tags" -TimeoutSec 3 | Out-Null; $Ready = $true; break } catch { }
        }
        if (-not $Ready) { throw "Ollama was installed but its local API did not start at $BaseUrl." }
    }
    $Tags = Invoke-RestMethod -Uri "$($BaseUrl.TrimEnd('/'))/api/tags" -TimeoutSec 5
    if ($Model -and -not (@($Tags.models | ForEach-Object { $_.name }) -contains $Model)) {
        Write-Host "Downloading local model $Model (one-time, size depends on the model)..." -ForegroundColor Cyan
        & $OllamaExe pull $Model
        if ($LASTEXITCODE -ne 0) { throw "Ollama could not download model $Model." }
    }
    Write-Host "[OK] Ollama local model is ready" -ForegroundColor Green
}

Ensure-Ollama

$StartupDir = [Environment]::GetFolderPath("Startup")
$StartupFile = Join-Path $StartupDir "Barlas AI Agent.cmd"
$StartScript = Join-Path $RootDir "scripts\start-native.ps1"
$StartupText = "@echo off`r`nstart `"`" /min `"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`" -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$StartScript`"`r`n"
[IO.File]::WriteAllText($StartupFile, $StartupText, [Text.Encoding]::ASCII)

& (Join-Path $RootDir "scripts\start-native.ps1") -WaitReady
Write-Host "[OK] Barlas will start automatically when you sign in to Windows" -ForegroundColor Green
try {
    & (Join-Path $RootDir "scripts\desktop-native.ps1") -Action install
    Write-Host "[OK] Barlas Desktop shortcuts installed" -ForegroundColor Green
} catch {
    Write-Host "[WARN] Barlas core is ready, but desktop shortcuts were not installed: $($_.Exception.Message)" -ForegroundColor Yellow
    Write-Host "Run 'barlas desktop install' after Microsoft Edge is available." -ForegroundColor Yellow
}
