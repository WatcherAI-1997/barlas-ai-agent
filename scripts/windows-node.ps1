[CmdletBinding()]
param(
    [switch]$Configure,
    [switch]$Uninstall,
    [switch]$Once,
    [string]$BaseUrl,
    [string]$PairingCode,
    [string]$Name = $env:COMPUTERNAME
)

$ErrorActionPreference = "Stop"
$NodeRoot = Join-Path $env:LOCALAPPDATA "Barlas\desktop-node"
$ConfigPath = Join-Path $NodeRoot "node.json"
$RunKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$RunName = "Barlas Desktop Node"

function Protect-NodeFile([string]$Path) {
    $Identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    $Acl = New-Object Security.AccessControl.FileSecurity
    $Acl.SetAccessRuleProtection($true, $false)
    $Acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($Identity, "FullControl", "Allow"))
    $Acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new("NT AUTHORITY\SYSTEM", "FullControl", "Allow"))
    Set-Acl -LiteralPath $Path -AclObject $Acl
}

function Assert-BaseUrl([string]$Url) {
    $Uri = [Uri]$Url
    if ($Uri.Scheme -eq "https") { return }
    if ($Uri.Scheme -eq "http" -and $Uri.IsLoopback) { return }
    throw "Desktop node requires HTTPS, except for a loopback http://127.0.0.1 or localhost address."
}

function Invoke-NodeApi([string]$Method, [string]$Path, $Body = $null, [string]$Token = "") {
    $Headers = @{}
    if ($Token) { $Headers.Authorization = "Bearer $Token" }
    $Arguments = @{ Method = $Method; Uri = "$($script:Config.baseUrl.TrimEnd('/'))$Path"; Headers = $Headers; TimeoutSec = 30 }
    if ($null -ne $Body) { $Arguments.ContentType = "application/json"; $Arguments.Body = ($Body | ConvertTo-Json -Depth 8 -Compress) }
    return Invoke-RestMethod @Arguments
}

function Save-Configuration([string]$Url, [string]$Token, [string]$NodeName) {
    New-Item -ItemType Directory -Force -Path $NodeRoot | Out-Null
    $Protected = ConvertTo-SecureString $Token -AsPlainText -Force | ConvertFrom-SecureString
    $Temporary = "$ConfigPath.tmp.$([Guid]::NewGuid().ToString('N'))"
    @{ schemaVersion = 1; baseUrl = $Url.TrimEnd('/'); name = $NodeName; protectedToken = $Protected } |
        ConvertTo-Json | Set-Content -LiteralPath $Temporary -Encoding UTF8
    Protect-NodeFile $Temporary
    Move-Item -LiteralPath $Temporary -Destination $ConfigPath -Force
}

function Load-Configuration {
    if (-not (Test-Path -LiteralPath $ConfigPath)) { throw "Desktop node is not configured." }
    $Value = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
    Assert-BaseUrl $Value.baseUrl
    $Secure = ConvertTo-SecureString $Value.protectedToken
    $Token = [Net.NetworkCredential]::new("", $Secure).Password
    if (-not $Token.StartsWith("barlas_node_")) { throw "Stored node token is invalid." }
    return @{ baseUrl = [string]$Value.baseUrl; name = [string]$Value.name; token = $Token }
}

if ($Uninstall) {
    Remove-ItemProperty -Path $RunKey -Name $RunName -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $NodeRoot) { Remove-Item -LiteralPath $NodeRoot -Recurse -Force }
    Write-Output "Barlas Desktop Node removed. Revoke the node in Barlas if it is still listed."
    exit 0
}

if ($Configure) {
    if (-not $BaseUrl) { $BaseUrl = Read-Host "Barlas URL [http://127.0.0.1:17840]"; if (-not $BaseUrl) { $BaseUrl = "http://127.0.0.1:17840" } }
    if (-not $PairingCode) { $PairingCode = Read-Host "One-time node pairing code" }
    Assert-BaseUrl $BaseUrl
    $script:Config = @{ baseUrl = $BaseUrl.TrimEnd('/') }
    $Paired = Invoke-NodeApi "POST" "/nodes/pair" @{
        code = $PairingCode; name = $Name; platform = "windows"; capabilities = @("notifications")
    }
    if (-not $Paired.token -or -not $Paired.node.id) { throw "Barlas returned an invalid pairing response." }
    Save-Configuration $script:Config.baseUrl ([string]$Paired.token) $Name
    $ScriptPath = $MyInvocation.MyCommand.Path
    New-Item -Path $RunKey -Force | Out-Null
    Set-ItemProperty -Path $RunKey -Name $RunName -Value "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$ScriptPath`""
    Write-Output "Barlas Desktop Node paired: $($Paired.node.id)"
    Write-Output "Autostart enabled for the current Windows user."
    exit 0
}

$script:Config = Load-Configuration
$Token = $script:Config.token

function Poll-Once($NotifyIcon = $null) {
    Invoke-NodeApi "POST" "/nodes/heartbeat" @{ capabilities = @("notifications") } $Token | Out-Null
    $Response = Invoke-NodeApi "GET" "/nodes/commands" $null $Token
    foreach ($Command in @($Response.commands)) {
        $Succeeded = $false
        $Failure = $null
        try {
            if ($Command.kind -ne "notify") { throw "Unsupported command kind" }
            $Title = ([string]$Command.payload.title).Substring(0, [Math]::Min(63, ([string]$Command.payload.title).Length))
            $Body = ([string]$Command.payload.body).Substring(0, [Math]::Min(255, ([string]$Command.payload.body).Length))
            if ($NotifyIcon) {
                $NotifyIcon.BalloonTipTitle = $Title
                $NotifyIcon.BalloonTipText = $Body
                $NotifyIcon.ShowBalloonTip(8000)
            } else { Write-Output "$Title`: $Body" }
            $Succeeded = $true
        } catch { $Failure = $_.Exception.Message }
        try {
            $ResultBody = @{ succeeded = $Succeeded }
            if ($Failure) { $ResultBody.error = $Failure.Substring(0, [Math]::Min(500, $Failure.Length)) }
            Invoke-NodeApi "POST" "/nodes/commands/$($Command.id)/result" $ResultBody $Token | Out-Null
        } catch { Write-Warning "Could not acknowledge command $($Command.id): $($_.Exception.Message)" }
    }
}

if ($Once) { Poll-Once; exit 0 }

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$Tray = New-Object Windows.Forms.NotifyIcon
$Tray.Icon = [Drawing.SystemIcons]::Information
$Tray.Text = "Barlas Desktop Node"
$Tray.Visible = $true
$Menu = New-Object Windows.Forms.ContextMenuStrip
$Open = $Menu.Items.Add("Open Barlas")
$Exit = $Menu.Items.Add("Exit")
$script:Running = $true
$Open.add_Click({ Start-Process $script:Config.baseUrl })
$Exit.add_Click({ $script:Running = $false })
$Tray.ContextMenuStrip = $Menu
$Tray.BalloonTipTitle = "Barlas Desktop Node"
$Tray.BalloonTipText = "Connected. Only approved notification commands are supported."
$Tray.ShowBalloonTip(5000)
try {
    while ($script:Running) {
        try { Poll-Once $Tray } catch { Write-Warning $_.Exception.Message }
        for ($Index = 0; $Index -lt 50 -and $script:Running; $Index++) {
            [Windows.Forms.Application]::DoEvents()
            Start-Sleep -Milliseconds 100
        }
    }
} finally {
    $Tray.Visible = $false
    $Tray.Dispose()
}
