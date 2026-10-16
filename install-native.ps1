[CmdletBinding()]
param([switch]$NonInteractive)

$ErrorActionPreference = "Stop"
$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BarlasHome = Join-Path $env:LOCALAPPDATA "Barlas"
$EnvFile = Join-Path $RootDir "deploy\native.env"
$SupportedLanguageCodes = @("tr", "az", "azb", "tk", "gag", "qxq", "kmz", "klj", "uz", "ug", "ili", "slr", "ybe", "kk", "ky", "kaa", "nog", "tt", "ba", "crh", "kum", "krc", "kdr", "uum", "cv", "sah", "dlg", "tyv", "kim", "alt", "kjh", "cjs", "clw", "fuy", "sty", "mn", "ru", "en")

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
        $Selected = [Array]::IndexOf($Values, $Default)
        if ($Selected -lt 0) { $Selected = 0 }
        $ReservedLines = $Values.Count + 1
        for ($Line = 0; $Line -lt $ReservedLines; $Line++) { Write-Host "" }
        $Top = [Console]::CursorTop - $ReservedLines
        $PreviousCursor = [Console]::CursorVisible
        $CursorCaptured = $true
        [Console]::CursorVisible = $false
        while ($true) {
            [Console]::SetCursorPosition(0, $Top)
            $Width = [Console]::WindowWidth - 1
            if ($Width -lt 20) { return $null }
            for ($Index = 0; $Index -lt $Values.Count; $Index++) {
                $Prefix = if ($Index -eq $Selected) { "  > " } else { "    " }
                $DefaultMarker = if ($Values[$Index] -eq $Default) { "  default" } else { "" }
                $Text = "$Prefix$($Labels[$Index])$DefaultMarker"
                if ($Text.Length -gt $Width) { $Text = $Text.Substring(0, $Width) }
                if ($Index -eq $Selected) { Write-Host $Text.PadRight($Width) -ForegroundColor Cyan }
                else { Write-Host $Text.PadRight($Width) }
            }
            $Help = "  Up/Down or number; Enter selects; Esc keeps default"
            if ($Help.Length -gt $Width) { $Help = $Help.Substring(0, $Width) }
            Write-Host $Help.PadRight($Width) -ForegroundColor DarkGray
            $Key = [Console]::ReadKey($true)
            if ($Key.Key -eq [ConsoleKey]::UpArrow) { $Selected = ($Selected - 1 + $Values.Count) % $Values.Count; continue }
            if ($Key.Key -eq [ConsoleKey]::DownArrow) { $Selected = ($Selected + 1) % $Values.Count; continue }
            if ($Key.Key -eq [ConsoleKey]::Enter) { return $Values[$Selected] }
            if ($Key.Key -eq [ConsoleKey]::Escape) { return $Default }
            $Number = 0
            if ([int]::TryParse([string]$Key.KeyChar, [ref]$Number) -and $Number -ge 1 -and $Number -le $Values.Count) { return $Values[$Number - 1] }
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
    if ($NonInteractive) { return "" }
    $Choice = Read-MenuChoice "" "Interface language" @("ru", "en", "later", "other") @("Русский", "English", "Choose later in the web cabinet", "Another language code") "ru"
    if ($Choice -eq "later") { return "" }
    if ($Choice -ne "other") { return $Choice }
    while ($true) {
        $Code = (Read-Host "Language code").Trim().ToLowerInvariant()
        if ($Code -in $SupportedLanguageCodes) { return $Code }
        Write-Host "Unsupported code. Examples: ru, en, tr, az, uz, kk, ky, tt, mn." -ForegroundColor Yellow
    }
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
    $Identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    $Acl = New-Object Security.AccessControl.FileSecurity
    $Acl.SetAccessRuleProtection($true, $false)
    $Acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($Identity, [Security.AccessControl.FileSystemRights]::FullControl, [Security.AccessControl.AccessControlType]::Allow))
    $Acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new("NT AUTHORITY\SYSTEM", [Security.AccessControl.FileSystemRights]::FullControl, [Security.AccessControl.AccessControlType]::Allow))
    Set-Acl -LiteralPath $Path -AclObject $Acl
}

if (Test-Path -LiteralPath $EnvFile -PathType Leaf) {
    Protect-SecretFile $EnvFile
    Write-Host "[OK] Using existing protected native configuration" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "BARLAS PERSONAL SETUP" -ForegroundColor White
    Write-Host "Use Up/Down and Enter. Number keys also work." -ForegroundColor DarkGray
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
    $OwnerLanguage = Read-OwnerLanguage
    $ProviderAliases = @{ "openai api" = "openai"; "openai codex" = "openai"; "anthropic api" = "anthropic"; "local ollama" = "ollama" }
    $ModelProvider = Read-MenuChoice "MODEL_PROVIDER" "Model provider" @("openai", "anthropic", "ollama") @("OpenAI API - cloud key required", "Anthropic API - cloud key required", "Ollama - local and private, no cloud key") "openai" $ProviderAliases
    $DefaultModel = if ($ModelProvider -eq "ollama") { "qwen3:8b" } elseif ($ModelProvider -eq "anthropic") { "claude-sonnet-4-5" } else { "gpt-5" }
    $ModelName = Read-ValidatedValue "MODEL_NAME" "Fast/default model name" $DefaultModel {
        param($Value) -not [string]::IsNullOrWhiteSpace([string]$Value) -and -not ([string]$Value).Contains("`r") -and -not ([string]$Value).Contains("`n")
    } "Model name cannot be blank."
    $DeepModelName = Read-ValidatedValue "DEEP_MODEL_NAME" "Deep model name" $ModelName {
        param($Value) -not [string]::IsNullOrWhiteSpace([string]$Value) -and -not ([string]$Value).Contains("`r") -and -not ([string]$Value).Contains("`n")
    } "Deep model name cannot be blank."
    $MediaApiKey = ""
    if ($ModelProvider -ne "openai") {
        $MediaApiKey = Read-Value "MEDIA_API_KEY" "Optional OpenAI key for media features" "" -Secret
        $VisionModel = if ($MediaApiKey) { Read-Value "VISION_MODEL" "OpenAI vision/PDF model name" "gpt-4.1-mini" } else { "" }
    } else { $VisionModel = Read-Value "VISION_MODEL" "Vision/PDF model name" $ModelName }
    $ModelApiKey = if ($ModelProvider -eq "ollama") { "" } else {
        Read-ValidatedValue "MODEL_API_KEY" "Dedicated model API key" "" {
            param($Value) -not [string]::IsNullOrWhiteSpace([string]$Value) -and -not ([string]$Value).Contains("`r") -and -not ([string]$Value).Contains("`n")
        } "An API key is required for this provider." -Secret
    }
    $OllamaBaseUrl = if ($ModelProvider -eq "ollama") { Read-Value "OLLAMA_BASE_URL" "Ollama URL" "http://127.0.0.1:11434" } else { "http://127.0.0.1:11434" }
    $TelegramBotToken = Read-Value "TELEGRAM_BOT_TOKEN" "Dedicated Telegram bot token; blank disables Telegram" "" -Secret

    $Settings = [ordered]@{
        APP_ENV = "production"; APP_NAME = "Barlas AI Agent"; BARLAS_INSTALL_MODE = "native"
        HOST = "127.0.0.1"; PORT = $Port; BARLAS_HTTP_PORT = $Port
        DATABASE_URL = "postgresql://native-runtime"; BARLAS_NATIVE_ROOT = $RootDir
        BARLAS_NATIVE_DATA = (Join-Path $BarlasHome "data"); BARLAS_NATIVE_DATABASE_PORT = "17841"
        BARLAS_API_TOKEN = New-RandomHex 32; BARLAS_GATEWAY_TOKEN = New-RandomHex 32
        MODEL_PROVIDER = $ModelProvider; MODEL_NAME = $ModelName; MODEL_API_KEY = $ModelApiKey; OLLAMA_BASE_URL = $OllamaBaseUrl
        MEDIA_API_KEY = $MediaApiKey; VISION_MODEL = $VisionModel; TRANSCRIPTION_MODEL = "gpt-4o-mini-transcribe"
        SPEECH_MODEL = "gpt-4o-mini-tts"; EMBEDDING_MODEL = ""; DEEP_MODEL_NAME = $DeepModelName
        CONNECTOR_VAULT_KEY = New-RandomBase64 32; CONNECTOR_VAULT_KEY_VERSION = "1"
        OWNER_EMAIL = $OwnerEmail; OWNER_DISPLAY_NAME = $OwnerDisplayName; OWNER_LANGUAGE = $OwnerLanguage
        WORKSPACE_ROOT = (Join-Path $BarlasHome "data\workspaces"); WEB_ROOT = (Join-Path $RootDir "web")
        BROWSER_WS_ENDPOINT = "local://chromium"; JOB_WORKER_ENABLED = "true"; AGENT_RUN_WORKER_ENABLED = "true"
        AGENT_RUN_WORKER_POLL_MS = "1000"; AGENT_RUN_WORKER_BATCH_SIZE = "2"; AGENT_RUN_LEASE_SECONDS = "300"
    }
    if ($TelegramBotToken) {
        $Settings["TELEGRAM_BOT_TOKEN"] = $TelegramBotToken
        $Settings["TELEGRAM_WEBHOOK_SECRET"] = New-RandomHex 32
        $Settings["TELEGRAM_POLLING_ENABLED"] = "true"
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
$StartupText = "@echo off`r`nstart `"`" /min powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$StartScript`"`r`n"
[IO.File]::WriteAllText($StartupFile, $StartupText, [Text.Encoding]::ASCII)

& (Join-Path $RootDir "scripts\start-native.ps1") -WaitReady
Write-Host "[OK] Barlas will start automatically when you sign in to Windows" -ForegroundColor Green
