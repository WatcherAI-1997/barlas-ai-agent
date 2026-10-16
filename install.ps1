[CmdletBinding()]
param(
    [string]$EnvFile,
    [switch]$NonInteractive,
    [switch]$PrepareOnly,
    [switch]$VerboseOutput
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$InstallLog = Join-Path $RootDir "logs\install-windows.log"
$EnvCreated = $false
$SupportedLanguageCodes = @("tr", "az", "azb", "tk", "gag", "qxq", "kmz", "klj", "uz", "ug", "ili", "slr", "ybe", "kk", "ky", "kaa", "nog", "tt", "ba", "crh", "kum", "krc", "kdr", "uum", "cv", "sah", "dlg", "tyv", "kim", "alt", "kjh", "cjs", "clw", "fuy", "sty", "mn", "ru", "en")

function Write-Info([string]$Message) { Write-Host "-> $Message" -ForegroundColor Cyan }
function Write-Ok([string]$Message) { Write-Host "[OK] $Message" -ForegroundColor Green }
function Stop-Install([string]$Message) { throw $Message }

function Show-Banner {
    $Mark = @(" ▄██▄  ▄██▄ ", " ▀██▀  ▀██▀ ", "            ", "    ▄██▄    ", "    ▀██▀    ")
    $Word = @("                             ", "█▀▀▄ ▄▀▀▄ █▀▀▄ █    ▄▀▀▄ ▄▀▀▀", "█▀▀▄ █▀▀█ █▀█  █    █▀▀█  ▀▀▄", "▀▀▀  ▀  ▀ ▀  ▀ ▀▀▀▀ ▀  ▀ ▀▀▀ ", "                             ")
    Write-Host ""
    for ($Row = 0; $Row -lt $Mark.Count; $Row++) {
        Write-Host ($Mark[$Row] + "  ") -ForegroundColor Red -NoNewline
        Write-Host $Word[$Row] -ForegroundColor White
    }
    Write-Host "              A I   A G E N T" -ForegroundColor DarkGray
    Write-Host "              THINK AHEAD." -ForegroundColor Red -NoNewline
    Write-Host " ACT BEYOND." -ForegroundColor White
    Write-Host ""
}

function Test-Command([string]$Name) {
    return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Read-Setting([string]$Path, [string]$Name) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return "" }
    $Prefix = "$Name="
    foreach ($Line in [System.IO.File]::ReadAllLines($Path)) {
        if ($Line.StartsWith($Prefix, [System.StringComparison]::Ordinal)) {
            $Value = $Line.Substring($Prefix.Length)
            if ($Value.Length -ge 2 -and $Value[0] -eq "'" -and $Value[$Value.Length - 1] -eq "'") {
                return $Value.Substring(1, $Value.Length - 2).Replace("\'", "'")
            }
            return $Value.Trim('"')
        }
    }
    return ""
}

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

function Assert-SingleLine([string]$Name, [string]$Value) {
    if ($Value.Contains("`r") -or $Value.Contains("`n")) { Stop-Install "$Name must be a single line" }
}

function New-RandomHex([int]$Bytes) {
    $Buffer = New-Object byte[] $Bytes
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($Buffer)
    return -join ($Buffer | ForEach-Object { $_.ToString("x2") })
}

function New-RandomBase64([int]$Bytes) {
    $Buffer = New-Object byte[] $Bytes
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($Buffer)
    return [Convert]::ToBase64String($Buffer)
}

function ConvertTo-EnvValue([string]$Value) {
    return "'" + $Value.Replace("'", "\'") + "'"
}

function Protect-SecretFile([string]$Path) {
    if ($env:OS -ne "Windows_NT") { return }
    $UserSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $PreviousPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        & icacls.exe $Path "/inheritance:r" "/grant:r" "*${UserSid}:(F)" "*S-1-5-18:(F)" *> $null
        $AclExitCode = $LASTEXITCODE
    } finally { $ErrorActionPreference = $PreviousPreference }
    if ($AclExitCode -ne 0) { throw "Unable to protect the Barlas configuration file for the current Windows user." }
}

function Invoke-Logged([string]$Label, [string[]]$Arguments) {
    Write-Info $Label
    $LogDirectory = Split-Path -Parent $InstallLog
    New-Item -ItemType Directory -Force -Path $LogDirectory | Out-Null
    $PreviousPreference = $ErrorActionPreference
    $CommandExitCode = 1
    try {
        $ErrorActionPreference = "Continue"
        if ($VerboseOutput) {
            & docker @Arguments 2>&1 | Tee-Object -FilePath $InstallLog -Append
        } else {
            & docker @Arguments *>> $InstallLog
        }
        $CommandExitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $PreviousPreference
    }
    if ($CommandExitCode -ne 0) {
        if (Test-Path -LiteralPath $InstallLog) { Get-Content -LiteralPath $InstallLog -Tail 25 | Write-Host }
        Stop-Install "$Label failed. Full log: $InstallLog"
    }
    Write-Ok $Label
}

if ($env:BARLAS_BOOTSTRAP_ACTIVE -ne "1") { Show-Banner }
if ($env:OS -ne "Windows_NT") { Stop-Install "This installer is for Windows 10/11. Use ./install.sh --local on Linux." }
if (-not (Test-Command "docker")) { Stop-Install "Docker Desktop is missing. Install Docker Desktop with WSL 2, start it, then run this installer again." }
& cmd.exe /d /c "docker compose version >nul 2>nul"
if ($LASTEXITCODE -ne 0) { Stop-Install "Docker Compose v2 is required. Update Docker Desktop and enable WSL 2 based Linux containers." }
& cmd.exe /d /c "docker info >nul 2>nul"
if ($LASTEXITCODE -ne 0 -and -not $PrepareOnly) { Stop-Install "Docker Desktop is not running. Start it and wait until the engine is ready." }
if (-not (Test-Path -LiteralPath (Join-Path $RootDir "compose.production.yml") -PathType Leaf)) { Stop-Install "Run install.ps1 from a complete Barlas AI Agent checkout." }
if (-not (Test-Path -LiteralPath (Join-Path $RootDir "compose.local.yml") -PathType Leaf)) { Stop-Install "Local Compose override is missing." }

if ([string]::IsNullOrWhiteSpace($EnvFile)) { $EnvFile = Join-Path $RootDir "deploy\local.env" }
elseif (-not [IO.Path]::IsPathRooted($EnvFile)) { $EnvFile = Join-Path $RootDir $EnvFile }
$EnvFile = [IO.Path]::GetFullPath($EnvFile)

if (Test-Path -LiteralPath $EnvFile) {
    if (-not (Test-Path -LiteralPath $EnvFile -PathType Leaf)) { Stop-Install "Environment path must be a regular file: $EnvFile" }
    $ExistingText = [IO.File]::ReadAllText($EnvFile)
    if ($ExistingText -match 'replace-with-|agent\.example\.com|owner@example\.com') { Stop-Install "Existing environment file still contains placeholders: $EnvFile" }
    $ConfiguredMode = Read-Setting $EnvFile "BARLAS_INSTALL_MODE"
    if ($ConfiguredMode -and $ConfiguredMode -ne "local") { Stop-Install "Windows installation supports local mode only; this file is configured for public mode." }
    Protect-SecretFile $EnvFile
    Write-Ok "Using existing protected configuration: $EnvFile"
} else {
    Write-Info "Creating protected local configuration"
    $HttpPort = Read-Value "BARLAS_HTTP_PORT" "Local web port" "17840"
    $OwnerEmail = Read-Value "OWNER_EMAIL" "First owner email (local identity only)" "owner@barlas.local"
    $OwnerDisplayName = Read-Value "OWNER_DISPLAY_NAME" "First owner display name" "Barlas Owner"
    $OwnerLanguage = Read-Value "OWNER_LANGUAGE" "Owner language code; blank means choose on first login"
    $ModelProvider = (Read-Value "MODEL_PROVIDER" "Model provider (openai or anthropic)" "openai").ToLowerInvariant()
    if ($ModelProvider -notin @("openai", "anthropic")) { Stop-Install "Model provider must be openai or anthropic" }
    $ModelName = Read-Value "MODEL_NAME" "Fast/default model name"
    $DeepModelName = Read-Value "DEEP_MODEL_NAME" "Deep model name" $ModelName
    $MediaApiKey = ""
    if ($ModelProvider -eq "anthropic") {
        $MediaApiKey = Read-Value "MEDIA_API_KEY" "Optional OpenAI key for media features" "" -Secret
        $VisionModel = if ($MediaApiKey) { Read-Value "VISION_MODEL" "OpenAI vision/PDF model name" "gpt-4.1-mini" } else { "" }
    } else {
        $VisionModel = Read-Value "VISION_MODEL" "Vision/PDF model name" $ModelName
    }
    $TranscriptionModel = Read-Value "TRANSCRIPTION_MODEL" "Transcription model" "gpt-4o-mini-transcribe"
    $SpeechModel = Read-Value "SPEECH_MODEL" "Speech model" "gpt-4o-mini-tts"
    $EmbeddingModel = Read-Value "EMBEDDING_MODEL" "Embedding model; blank disables semantic embeddings"
    $ModelApiKey = Read-Value "MODEL_API_KEY" "Dedicated model API key" "" -Secret
    $TelegramBotToken = Read-Value "TELEGRAM_BOT_TOKEN" "Dedicated Telegram bot token; blank disables Telegram" "" -Secret

    $Values = @{
        BARLAS_HTTP_PORT = $HttpPort; OWNER_EMAIL = $OwnerEmail; OWNER_DISPLAY_NAME = $OwnerDisplayName
        OWNER_LANGUAGE = $OwnerLanguage; MODEL_PROVIDER = $ModelProvider; MODEL_NAME = $ModelName
        DEEP_MODEL_NAME = $DeepModelName; MEDIA_API_KEY = $MediaApiKey; VISION_MODEL = $VisionModel
        TRANSCRIPTION_MODEL = $TranscriptionModel; SPEECH_MODEL = $SpeechModel; EMBEDDING_MODEL = $EmbeddingModel
        MODEL_API_KEY = $ModelApiKey; TELEGRAM_BOT_TOKEN = $TelegramBotToken
    }
    foreach ($Pair in $Values.GetEnumerator()) { Assert-SingleLine $Pair.Key ([string]$Pair.Value) }
    if ($HttpPort -notmatch '^\d+$' -or [int]$HttpPort -lt 1 -or [int]$HttpPort -gt 65535) { Stop-Install "Local web port must be between 1 and 65535" }
    if ($OwnerEmail -notmatch '^.+@.+\..+$') { Stop-Install "Owner email is invalid" }
    if ($OwnerLanguage -and $OwnerLanguage -notin $SupportedLanguageCodes) { Stop-Install "Owner language is unsupported" }
    if ([string]::IsNullOrWhiteSpace($ModelName)) { Stop-Install "Fast/default model name is required" }
    if ([string]::IsNullOrWhiteSpace($ModelApiKey)) { Stop-Install "Model API key is required" }

    $Settings = [ordered]@{
        APP_NAME = "Barlas AI Agent"; BARLAS_INSTALL_MODE = "local"; BARLAS_DOMAIN = "localhost"
        BARLAS_HTTP_PORT = $HttpPort; BARLAS_HTTPS_PORT = "0"; POSTGRES_PASSWORD = New-RandomHex 32
        BARLAS_API_TOKEN = New-RandomHex 32; BARLAS_GATEWAY_TOKEN = New-RandomHex 32
        MODEL_PROVIDER = $ModelProvider; MODEL_NAME = $ModelName; MODEL_API_KEY = $ModelApiKey
        MEDIA_API_KEY = $MediaApiKey; VISION_MODEL = $VisionModel; TRANSCRIPTION_MODEL = $TranscriptionModel
        SPEECH_MODEL = $SpeechModel; EMBEDDING_MODEL = $EmbeddingModel; DEEP_MODEL_NAME = $DeepModelName
        CONNECTOR_VAULT_KEY = New-RandomBase64 32; CONNECTOR_VAULT_KEY_VERSION = "1"
        OWNER_EMAIL = $OwnerEmail; OWNER_DISPLAY_NAME = $OwnerDisplayName; OWNER_LANGUAGE = $OwnerLanguage
        BROWSER_WS_ENDPOINT = "ws://browser:3000/"; SANDBOX_SOCKET_PATH = "/run/barlas-sandbox/sandbox.sock"
        SANDBOX_SHARED_TOKEN = New-RandomHex 32; AGENT_RUN_WORKER_ENABLED = "true"
        AGENT_RUN_WORKER_POLL_MS = "1000"; AGENT_RUN_WORKER_BATCH_SIZE = "2"; AGENT_RUN_LEASE_SECONDS = "300"
        BACKUP_RETENTION_DAYS = "14"; BACKUP_INTERVAL_SECONDS = "86400"
    }
    if ($TelegramBotToken) {
        $Settings["TELEGRAM_BOT_TOKEN"] = $TelegramBotToken
        $Settings["TELEGRAM_WEBHOOK_SECRET"] = New-RandomHex 32
        $Settings["TELEGRAM_POLLING_ENABLED"] = "true"
    }
    $Directory = Split-Path -Parent $EnvFile
    New-Item -ItemType Directory -Force -Path $Directory | Out-Null
    $Temporary = "$EnvFile.tmp.$([Guid]::NewGuid().ToString('N'))"
    try {
        $Lines = foreach ($Pair in $Settings.GetEnumerator()) { "$($Pair.Key)=$(ConvertTo-EnvValue ([string]$Pair.Value))" }
        [IO.File]::WriteAllLines($Temporary, $Lines, (New-Object Text.UTF8Encoding($false)))
        Protect-SecretFile $Temporary
        Move-Item -LiteralPath $Temporary -Destination $EnvFile
        Protect-SecretFile $EnvFile
    } finally {
        if (Test-Path -LiteralPath $Temporary) { Remove-Item -LiteralPath $Temporary -Force }
    }
    $EnvCreated = $true
    Write-Ok "Protected configuration created: $EnvFile"
}

$env:BARLAS_ENV_FILE = $EnvFile
$ComposeArgs = @("compose", "-f", (Join-Path $RootDir "compose.production.yml"), "-f", (Join-Path $RootDir "compose.local.yml"), "--env-file", $EnvFile)
Invoke-Logged "Validate the isolated Barlas stack" ($ComposeArgs + @("config", "--quiet"))

if ($PrepareOnly) {
    Write-Ok "Configuration is ready; containers were not started"
    Write-Host "Next: .\install.ps1 -EnvFile `"$EnvFile`""
    exit 0
}

if ($EnvCreated) {
    $Port = [int](Read-Setting $EnvFile "BARLAS_HTTP_PORT")
    $Listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
    if ($Listener) { Stop-Install "Host port $Port is already in use. Choose another BARLAS_HTTP_PORT in $EnvFile." }
}

Invoke-Logged "Build and start Barlas AI Agent" ($ComposeArgs + @("--profile", "backup", "up", "-d", "--build"))
& (Join-Path $RootDir "scripts\doctor.ps1") -EnvFile $EnvFile -RequireRunning
if ($LASTEXITCODE -ne 0) { Stop-Install "Post-install diagnostics failed" }

$Port = Read-Setting $EnvFile "BARLAS_HTTP_PORT"
Write-Host ""
Write-Host "Installation complete." -ForegroundColor Green
Write-Host "Built-in skills: 30 installed and active"
Write-Host "Web address: http://127.0.0.1:$Port"
Write-Host "Dashboard link: .\scripts\dashboard-url.ps1 -EnvFile `"$EnvFile`""
Write-Host "Terminal CLI: .\barlas.ps1"
Write-Host "Diagnostics: .\scripts\doctor.ps1 -EnvFile `"$EnvFile`" -RequireRunning"
Write-Host "Secrets remain only in $EnvFile with a restricted Windows ACL; the installer never prints them."
