$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$ExpectedSha256 = "93999a50e01daff9955d020a74a18ec75b9140b6d976abe9e790edd2bf836195"
$ExpectedIconSha256 = "4ba86c089b1582361db3fc244d430641c6f66d4121663e0e22a3ef35b577848e"
$Source = "https://raw.githubusercontent.com/WatcherAI-1997/barlas-ai-agent/main/scripts/windows-node.ps1"
$IconSource = "https://raw.githubusercontent.com/WatcherAI-1997/barlas-ai-agent/main/assets/brand/barlas-ai-agent-logo-original.png"
$InstallRoot = Join-Path $env:LOCALAPPDATA "Barlas\desktop-node"
$Destination = Join-Path $InstallRoot "windows-node.ps1"
$IconDestination = Join-Path $InstallRoot "barlas-icon.png"
$Temporary = Join-Path ([IO.Path]::GetTempPath()) "barlas-node-$([Guid]::NewGuid().ToString('N')).ps1"
$TemporaryIcon = Join-Path ([IO.Path]::GetTempPath()) "barlas-icon-$([Guid]::NewGuid().ToString('N')).png"

try {
    Write-Host "`n  Barlas Desktop Node" -ForegroundColor White
    Write-Host "  Windows notifications only - no remote shell`n" -ForegroundColor DarkGray
    Invoke-WebRequest -UseBasicParsing -Uri $Source -OutFile $Temporary
    $Actual = (Get-FileHash -LiteralPath $Temporary -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($Actual -ne $ExpectedSha256) { throw "Desktop node download checksum mismatch. Installation stopped." }
    Invoke-WebRequest -UseBasicParsing -Uri $IconSource -OutFile $TemporaryIcon
    $ActualIcon = (Get-FileHash -LiteralPath $TemporaryIcon -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($ActualIcon -ne $ExpectedIconSha256) { throw "Desktop node icon checksum mismatch. Installation stopped." }
    New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null
    Copy-Item -LiteralPath $Temporary -Destination $Destination -Force
    Copy-Item -LiteralPath $TemporaryIcon -Destination $IconDestination -Force
    $Url = Read-Host "Barlas URL [http://127.0.0.1:17840]"
    if (-not $Url) { $Url = "http://127.0.0.1:17840" }
    $Code = Read-Host "One-time code from: barlas node-pair"
    if (-not $Code.StartsWith("NODE-")) { throw "Invalid pairing code." }
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $Destination -Configure -BaseUrl $Url -PairingCode $Code
    if ($LASTEXITCODE -ne 0) { throw "Desktop node pairing failed." }
    Start-Process powershell.exe -ArgumentList @("-NoProfile", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-File", "`"$Destination`"")
    Write-Host "`nDesktop node installed and started." -ForegroundColor Green
    Write-Host "Its token is protected with Windows DPAPI for your account."
    Write-Host "Revoke it anytime with the Barlas nodes screen or CLI."
} catch {
    Write-Error $_.Exception.Message
    exit 1
} finally {
    Remove-Item -LiteralPath $Temporary -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $TemporaryIcon -Force -ErrorAction SilentlyContinue
}
