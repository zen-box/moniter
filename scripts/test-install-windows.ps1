param([string]$ServerBinary = (Join-Path (Split-Path -Parent $PSScriptRoot) 'target-review\release\aegis-server.exe'))
# Exercise the installer with a real server and isolated files. Only GitHub,
# permissions and Task Scheduler are mocked; no administrator access is needed.
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
. (Join-Path $Repo 'install.ps1')
$Fixture = Join-Path ([IO.Path]::GetTempPath()) ('moniter-install-test-' + [guid]::NewGuid().ToString('N'))
$script:TestRoot = Join-Path $Fixture 'server'
$script:Task = $null
$script:Runner = $null
$script:StopCount = 0
$script:FailStart = $false
$script:Output = [Collections.Generic.List[string]]::new()
$script:Mode = 'good'
$script:Tag = 'v0.1.0'
$Probe = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0)
$Probe.Start(); $script:TestPort = $Probe.LocalEndpoint.Port; $Probe.Stop()
New-Item -ItemType Directory -Path $Fixture | Out-Null
function Assert($Condition,[string]$Message) { if (-not $Condition) { throw $Message } }
function Test-MoniterAdministrator { $true }
function icacls { $global:LASTEXITCODE = 0 }
function Write-Host { param([Parameter(ValueFromRemainingArguments=$true)]$Objects) $script:Output.Add(($Objects -join ' ')) }
function Write-Warning { param($Message) $script:Output.Add([string]$Message) }
function Get-ScheduledTask { param($TaskName,$ErrorAction) $script:Task }
function Export-ScheduledTask { param($TaskName) $script:Task | ConvertTo-Json -Depth 8 -Compress }
function New-ScheduledTaskAction { param($Execute,$Argument,$WorkingDirectory) [pscustomobject]@{Execute=$Execute; Arguments=$Argument; WorkingDirectory=$WorkingDirectory} }
function New-ScheduledTaskTrigger { param([switch]$AtStartup) Assert $AtStartup 'Task must start at boot'; 'startup' }
function New-ScheduledTaskPrincipal { param($UserId,$LogonType,$RunLevel) Assert ($UserId -eq 'SYSTEM' -and $LogonType -eq 'ServiceAccount') 'Task must run without a user login'; 'system' }
function New-ScheduledTaskSettingsSet {
    param([switch]$StartWhenAvailable,[switch]$AllowStartIfOnBatteries,[switch]$DontStopIfGoingOnBatteries,$ExecutionTimeLimit,$RestartCount,$RestartInterval,$MultipleInstances)
    Assert ($ExecutionTimeLimit -eq [TimeSpan]::Zero) 'Task must have no execution time limit'
    'settings'
}
function Register-ScheduledTask {
    param($TaskName,$Action,$Trigger,$Principal,$Settings,$Xml,[switch]$Force)
    if ($Xml) { $script:Task = $Xml | ConvertFrom-Json }
    else { $script:Task = [pscustomobject]@{Actions=@($Action); State='Ready'} }
}
function Unregister-ScheduledTask { param($TaskName,[switch]$Confirm,$ErrorAction) $script:Task = $null }
function Stop-ScheduledTask {
    param($TaskName,$ErrorAction)
    $script:StopCount++
    if ($script:Runner -and -not $script:Runner.HasExited) { Stop-Process -Id $script:Runner.Id -Force; $script:Runner.WaitForExit() }
    if ($script:Task) { $script:Task.State = 'Ready' }
}
function Start-ScheduledTask {
    param($TaskName)
    if ($script:FailStart) {
        $script:FailStart = $false
        [IO.File]::WriteAllText((Join-Path $script:TestRoot 'data\probe.db'),'failed migration')
        throw 'Injected startup failure'
    }
    $script:Runner = Start-Process -FilePath $script:Task.Actions[0].Execute -ArgumentList $script:Task.Actions[0].Arguments -WorkingDirectory $script:TestRoot -WindowStyle Hidden -PassThru
    $script:Task.State = 'Running'
}
function Invoke-RestMethod {
    param($Uri,$Headers,$TimeoutSec)
    $name = 'moniter-' + $script:Tag.Substring(1) + '-windows-amd64.zip'
    $assets = @([pscustomobject]@{name=$name; browser_download_url="https://github.com/zen-box/moniter/releases/download/$script:Tag/$name"})
    if ($script:Mode -eq 'missing-asset') { $assets = @() }
    [pscustomobject]@{tag_name=$script:Tag; draft=$false; prerelease=$false; assets=$assets}
}
function Invoke-WebRequest {
    param([switch]$UseBasicParsing,$Uri,$OutFile,$TimeoutSec)
    if ($OutFile) { Copy-Item -LiteralPath $script:ArchivePath -Destination $OutFile }
    else { Microsoft.PowerShell.Utility\Invoke-WebRequest -UseBasicParsing -Uri $Uri -TimeoutSec $TimeoutSec }
}
function Run-Installer {
    param([string]$Action='update')
    $script:Output.Clear()
    Install-MoniterServer -Action $Action -Port $script:TestPort -InstallDir $script:TestRoot | ForEach-Object { $script:Output.Add([string]$_) }
}
function Expect-Rejection([string]$Mode,[string]$Tag='v0.1.0') {
    $script:Mode=$Mode; $script:Tag=$Tag
    $stops=$script:StopCount; $rejected=$false
    try { Run-Installer } catch { $rejected=$true }
    Assert $rejected "Must reject $Mode"
    Assert ($script:StopCount -eq $stops) "Must reject $Mode before stopping the server"
    Assert ((Microsoft.PowerShell.Utility\Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$script:TestPort/api/v1/ping").Content -eq 'pong') 'Old server must stay available'
    $script:Mode='good'; $script:Tag='v0.1.0'
}
try {
    Assert (Test-Path -LiteralPath $ServerBinary) 'Build the server first, or pass -ServerBinary.'
    $Package = Join-Path $Fixture 'package'
    foreach ($directory in @('web\dist','web\assets','binaries')) { New-Item -ItemType Directory -Path (Join-Path $Package $directory) -Force | Out-Null }
    Copy-Item -LiteralPath $ServerBinary -Destination (Join-Path $Package 'moniter.exe')
    Copy-Item -LiteralPath (Join-Path $Repo 'install.sh'),(Join-Path $Repo 'install.ps1') -Destination $Package
    [IO.File]::WriteAllText((Join-Path $Package 'web\dist\index.html'),'<html><head><title>Moniter</title></head><body>installer fixture</body></html>')
    [IO.File]::WriteAllText((Join-Path $Package 'web\assets\world-map-paths.svg'),'<svg/>')
    foreach ($platform in @('linux-amd64','linux-arm64','windows-amd64')) { [IO.File]::WriteAllText((Join-Path $Package "binaries\aegis-agent-$platform"),'fixture') }
    @{component='server';version='0.1.0';platform='windows-amd64'} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $Package 'release.json') -Encoding UTF8
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $script:ArchivePath = Join-Path $Fixture 'good.zip'
    [IO.Compression.ZipFile]::CreateFromDirectory($Package,$script:ArchivePath)
    $env:MONITER_UPDATE_CHECK='0'
    Run-Installer -Action install
    Assert (Test-Path -LiteralPath "$script:TestRoot\data\probe.db") 'First install must initialize the real database'
    Assert (($script:Output | Where-Object { $_ -match '^\u7ba1\u7406\u5458\u5bc6\u7801:' }).Count -eq 1) 'First install must display the generated password once'
    Assert ((Microsoft.PowerShell.Utility\Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$script:TestPort/").Content.Contains('installer fixture')) 'Installed frontend must be served'
    New-Item -ItemType Directory -Path "$script:TestRoot\web\themes\custom" | Out-Null
    [IO.File]::WriteAllText("$script:TestRoot\web\themes\custom\index.html",'custom theme')
    [IO.File]::WriteAllText("$script:TestRoot\web\dist\old-chunk-Abcdef12.js",'old chunk')
    $settings = Get-Content -LiteralPath "$script:TestRoot\moniter.json" -Raw | ConvertFrom-Json
    $settings | Add-Member -NotePropertyName AEGIS_PUBLIC_URL -NotePropertyValue 'https://fixture.example'
    $settings | ConvertTo-Json | Set-Content -LiteralPath "$script:TestRoot\moniter.json" -Encoding UTF8
    # Obtain only this test instance's generated credential; never print it.
    $credential = Get-Content -LiteralPath "$script:TestRoot\logs\server.out.log" | Where-Object { $_ -match '^\u7ba1\u7406\u5458\u5bc6\u7801:' } | Select-Object -First 1
    $loginBody = @{username='admin';password=($credential -split ': ',2)[1]} | ConvertTo-Json
    $session = Microsoft.PowerShell.Utility\Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$script:TestPort/api/v1/admin/login" -ContentType 'application/json' -Body $loginBody
    Assert $session.success 'Generated credentials must allow login'
    Run-Installer
    Assert (-not ($script:Output | Where-Object { $_ -match '^\u7ba1\u7406\u5458\u5bc6\u7801:' })) 'Update must not repeat credentials'
    Assert ((Get-Content -LiteralPath "$script:TestRoot\web\themes\custom\index.html" -Raw) -eq 'custom theme') 'Update must preserve themes'
    Assert ((Get-Content -LiteralPath "$script:TestRoot\moniter.json" -Raw | ConvertFrom-Json).AEGIS_PUBLIC_URL -eq 'https://fixture.example') 'Update must preserve configuration'
    Assert (Test-Path -LiteralPath "$script:TestRoot\web\dist\old-chunk-Abcdef12.js") 'Update must preserve chunks requested by existing browser tabs'
    $login = Microsoft.PowerShell.Utility\Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$script:TestPort/api/v1/admin/login" -ContentType 'application/json' -Body $loginBody
    Assert $login.success 'Update must preserve the administrator database'
    Expect-Rejection 'missing-asset'
    Expect-Rejection 'agent' 'agent-v0.1.0'
    # A published archive missing an Agent must also fail before downtime.
    Remove-Item -LiteralPath "$Package\binaries\aegis-agent-linux-arm64"
    $script:ArchivePath=Join-Path $Fixture 'incomplete.zip'
    [IO.Compression.ZipFile]::CreateFromDirectory($Package,$script:ArchivePath)
    Expect-Rejection 'incomplete'
    $script:ArchivePath=Join-Path $Fixture 'good.zip'
    $script:FailStart=$true; $failed=$false
    try { Run-Installer } catch { $failed=$_.Exception.Message -match 'Injected startup failure' }
    Assert $failed 'Startup failure must reach the caller'
    $login=$null
    for ($i=0;$i -lt 20;$i++) {
        try { $login=Microsoft.PowerShell.Utility\Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$script:TestPort/api/v1/admin/login" -ContentType 'application/json' -Body $loginBody; if ($login.success) { break } } catch { }
        Start-Sleep -Milliseconds 500
    }
    Assert $login.success 'Rollback must restore a usable database and restart the old server'
    Assert ((Get-Content -LiteralPath "$script:TestRoot\web\themes\custom\index.html" -Raw) -eq 'custom theme') 'Rollback must preserve themes'
    'Windows installer: real server install, update, credentials, package rejection and startup/database rollback passed (Task Scheduler and GitHub mocked).'
} finally {
    Stop-ScheduledTask -TaskName MoniterServer
    foreach ($process in @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq "$script:TestRoot\moniter.exe" })) { Stop-Process -Id $process.Id -Force; $process.WaitForExit(10000) | Out-Null }
    if ((Split-Path -Leaf $Fixture) -notlike 'moniter-install-test-*') { throw 'Unexpected fixture directory' }
    Remove-Item -LiteralPath $Fixture -Recurse -Force
}
