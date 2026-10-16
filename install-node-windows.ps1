$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$ExpectedSha256 = "f9505ab43878351d15c84690b1545b4f89f086340eb33c6d82228fa84a1c7e40"
$Source = "https://raw.githubusercontent.com/WatcherAI-1997/barlas-ai-agent/main/scripts/windows-node.ps1"
$InstallRoot = Join-Path $env:LOCALAPPDATA "Barlas\desktop-node"
$Destination = Join-Path $InstallRoot "windows-node.ps1"
$Temporary = Join-Path ([IO.Path]::GetTempPath()) "barlas-node-$([Guid]::NewGuid().ToString('N')).ps1"

try {
    Write-Host "`n  Barlas Desktop Node" -ForegroundColor White
    Write-Host "  Windows notifications only - no remote shell`n" -ForegroundColor DarkGray
    Invoke-WebRequest -UseBasicParsing -Uri $Source -OutFile $Temporary
    $Actual = (Get-FileHash -LiteralPath $Temporary -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($Actual -ne $ExpectedSha256) { throw "Desktop node download checksum mismatch. Installation stopped." }
    New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null
    Copy-Item -LiteralPath $Temporary -Destination $Destination -Force
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
}
