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

function Read-MenuChoice([string]$EnvironmentName, [string]$Title, [string[]]$Values, [string[]]$Labels, [string]$Default) {
    if ($Values.Count -ne $Labels.Count) { throw "Invalid setup menu" }
    $EnvironmentValue = if ($EnvironmentName) { [Environment]::GetEnvironmentVariable($EnvironmentName) } else { "" }
    if (-not [string]::IsNullOrWhiteSpace($EnvironmentValue)) { return $EnvironmentValue.ToLowerInvariant() }
    if ($NonInteractive) { return $Default }
    Write-Host ""
    Write-Host $Title -ForegroundColor Cyan
    for ($Index = 0; $Index -lt $Values.Count; $Index++) {
        $DefaultMarker = if ($Values[$Index] -eq $Default) { " (default)" } else { "" }
        Write-Host "  [$($Index + 1)] $($Labels[$Index])$DefaultMarker"
    }
    while ($true) {
        $DefaultNumber = 1 + [Array]::IndexOf($Values, $Default)
        $Answer = (Read-Host "Choose 1-$($Values.Count) [$DefaultNumber]").Trim().ToLowerInvariant()
        if (-not $Answer) { return $Default }
        if ($Answer -match '^\d+$') {
            $Selected = [int]$Answer - 1
            if ($Selected -ge 0 -and $Selected -lt $Values.Count) { return $Values[$Selected] }
        }
        $Exact = [Array]::IndexOf($Values, $Answer)
        if ($Exact -ge 0) { return $Values[$Exact] }
        foreach ($Candidate in $Values) { if ($Answer.StartsWith($Candidate)) { return $Candidate } }
        Write-Host "Choose a menu number or one of: $($Values -join ', ')" -ForegroundColor Yellow
    }
}

function Read-OwnerLanguage {
    $EnvironmentValue = [Environment]::GetEnvironmentVariable("OWNER_LANGUAGE")
    if (-not [string]::IsNullOrWhiteSpace($EnvironmentValue)) { return $EnvironmentValue.ToLowerInvariant() }
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
    Write-Host "Choose menu numbers. Press Enter to accept a default." -ForegroundColor DarkGray
    $Port = Read-Value "BARLAS_HTTP_PORT" "Local web port" "17840"
    $OwnerEmail = Read-Value "OWNER_EMAIL" "First owner email (local identity only)" "owner@barlas.local"
    $OwnerDisplayName = Read-Value "OWNER_DISPLAY_NAME" "First owner display name" "Barlas Owner"
    $OwnerLanguage = Read-OwnerLanguage
    $ModelProvider = Read-MenuChoice "MODEL_PROVIDER" "Model provider" @("openai", "anthropic", "ollama") @("OpenAI API (cloud key required)", "Anthropic API (cloud key required)", "Ollama local and private (no cloud key)") "openai"
    $DefaultModel = if ($ModelProvider -eq "ollama") { "qwen3:8b" } elseif ($ModelProvider -eq "anthropic") { "claude-sonnet-4-5" } else { "gpt-5" }
    $ModelName = Read-Value "MODEL_NAME" "Fast/default model name" $DefaultModel
    $DeepModelName = Read-Value "DEEP_MODEL_NAME" "Deep model name" $ModelName
    $MediaApiKey = ""
    if ($ModelProvider -ne "openai") {
        $MediaApiKey = Read-Value "MEDIA_API_KEY" "Optional OpenAI key for media features" "" -Secret
        $VisionModel = if ($MediaApiKey) { Read-Value "VISION_MODEL" "OpenAI vision/PDF model name" "gpt-4.1-mini" } else { "" }
    } else { $VisionModel = Read-Value "VISION_MODEL" "Vision/PDF model name" $ModelName }
    $ModelApiKey = if ($ModelProvider -eq "ollama") { "" } else { Read-Value "MODEL_API_KEY" "Dedicated model API key" "" -Secret }
    $OllamaBaseUrl = if ($ModelProvider -eq "ollama") { Read-Value "OLLAMA_BASE_URL" "Ollama URL" "http://127.0.0.1:11434" } else { "http://127.0.0.1:11434" }
    $TelegramBotToken = Read-Value "TELEGRAM_BOT_TOKEN" "Dedicated Telegram bot token; blank disables Telegram" "" -Secret

    if ($Port -notmatch '^\d+$' -or [int]$Port -lt 1024 -or [int]$Port -gt 65535) { throw "Local web port must be between 1024 and 65535" }
    if ($OwnerEmail -notmatch '^.+@.+\..+$') { throw "Owner email is invalid" }
    if ($OwnerLanguage -and $OwnerLanguage -notin $SupportedLanguageCodes) { throw "Owner language is unsupported" }
    if (-not $ModelName) { throw "Model name is required" }
    if ($ModelProvider -ne "ollama" -and -not $ModelApiKey) { throw "Model API key is required" }

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
