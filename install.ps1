param(
    [ValidateSet('install', 'update')][string]$Action = 'install',
    [string]$Version = '',
    [ValidateRange(0,65535)][int]$Port = 0,
    [string]$InstallDir = $(if ($env:MONITER_INSTALL_DIR) { $env:MONITER_INSTALL_DIR } else { Join-Path $env:ProgramData 'Moniter' })
)
function Test-MoniterAdministrator {
    ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}
function Install-MoniterServer {
param(
    [ValidateSet('install', 'update')][string]$Action = 'install',
    [string]$Version = '',
    [ValidateRange(0,65535)][int]$Port = 0,
    [string]$InstallDir = $(if ($env:MONITER_INSTALL_DIR) { $env:MONITER_INSTALL_DIR } else { Join-Path $env:ProgramData 'Moniter' })
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
if (-not (Test-MoniterAdministrator)) { throw 'Run PowerShell as Administrator.' }
if (-not [Environment]::Is64BitOperatingSystem -or $env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { throw 'Only Windows amd64 is supported.' }
$Version = $Version -replace '^v',''
if ($Version -and $Version -notmatch '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$') { throw 'Use a version such as 0.1.0.' }
$Root = [IO.Path]::GetFullPath($InstallDir).TrimEnd('\')
if ($Root -eq [IO.Path]::GetPathRoot($Root).TrimEnd('\') -or $Root -eq $env:ProgramData -or $Root -eq $env:ProgramFiles -or $Root -eq $env:SystemRoot) { throw 'Choose a dedicated installation directory.' }
New-Item -ItemType Directory -Path $Root -Force | Out-Null
& icacls $Root /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)(F)' '*S-1-5-32-544:(OI)(CI)(F)' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not restrict installation directory permissions.' }
$Lock = [IO.File]::Open((Join-Path $Root '.install.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
$TaskName = 'MoniterServer'
$Task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($Task -and -not ($Task.Actions | Where-Object { $_.Arguments -and $_.Arguments.Contains("`"$Root\run.ps1`"") })) { $Lock.Dispose(); throw 'An unrelated MoniterServer task exists. Migrate it manually first.' }
$PreviousXml = if ($Task) { Export-ScheduledTask -TaskName $TaskName } else { $null }
$WasRunning = $Task -and $Task.State -eq 'Running'
$Staging = Join-Path $Root ('.install-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $Staging | Out-Null
$Config = Join-Path $Root 'moniter.json'
$HadConfig = Test-Path -LiteralPath $Config
$HadDb = Test-Path -LiteralPath (Join-Path $Root 'data\probe.db')
$Managed = @('moniter.exe','web\dist','web\assets','binaries','release.json','install.sh','install.ps1','run.ps1')
$Saved = [Collections.Generic.List[string]]::new()
$Replaced = [Collections.Generic.List[string]]::new()
$Changed = $false; $Stopped = $false; $Backup = $null
function Stop-MoniterProcess {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    $exe = Join-Path $Root 'moniter.exe'
    foreach ($process in @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe })) {
        Stop-Process -Id $process.Id -Force -ErrorAction Stop
        $process.WaitForExit(10000) | Out-Null
    }
}
try {
    $Api = 'https://api.github.com/repos/zen-box/moniter/releases/latest'
    if ($Version) { $Api = "https://api.github.com/repos/zen-box/moniter/releases/tags/v$Version" }
    Write-Host 'Checking official Moniter releases...'
    try { $Release = Invoke-RestMethod -Uri $Api -Headers @{ 'User-Agent'='Moniter-installer'; Accept='application/vnd.github+json'; 'X-GitHub-Api-Version'='2022-11-28' } -TimeoutSec 30 }
    catch { throw 'Could not get a stable server release. Publish the server Release first and check GitHub connectivity.' }
    if ($Release.draft -or $Release.prerelease -or $Release.tag_name -notmatch '^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$') { throw 'Expected a stable server Release, not an Agent Release.' }
    $Selected = $Release.tag_name.Substring(1)
    if ($Version -and $Version -ne $Selected) { throw 'Release version does not match the requested version.' }
    $Version = $Selected
    $Name = "moniter-$Version-windows-amd64.zip"
    $Url = "https://github.com/zen-box/moniter/releases/download/v$Version/$Name"
    if (-not ($Release.assets | Where-Object { $_.name -eq $Name -and $_.browser_download_url -eq $Url })) { throw 'The server Release does not contain the Windows amd64 package.' }
    $Download = Join-Path $Staging 'package.zip'
    Write-Host "Downloading Moniter $Version (windows-amd64)..."
    Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $Download -TimeoutSec 180
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $Package = Join-Path $Staging 'package'
    New-Item -ItemType Directory -Path $Package | Out-Null
    $Archive = [IO.Compression.ZipFile]::OpenRead($Download)
    try {
        [long]$Total = 0
        foreach ($Entry in $Archive.Entries) {
            $Total += $Entry.Length
            if ($Total -gt 512MB) { throw 'Package exceeds the extraction limit.' }
            $Relative = $Entry.FullName.Replace('\','/')
            if ([IO.Path]::IsPathRooted($Relative) -or $Relative.Contains(':') -or $Relative.Split('/') -contains '..' -or (($Entry.ExternalAttributes -shr 16) -band 0xF000) -eq 0xA000) { throw 'Unsafe path or link in archive.' }
            if ($Relative -notmatch '^(moniter\.exe|release\.json|README\.md|install\.sh|install\.ps1|binaries(/.*)?|web/?|web/(dist|assets)(/.*)?)$') { throw "Unexpected package entry: $Relative" }
            $Destination = [IO.Path]::GetFullPath((Join-Path $Package $Relative))
            if (-not $Destination.StartsWith($Package + '\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Package path escapes the extraction directory.' }
            if ($Relative.EndsWith('/')) { New-Item -ItemType Directory -Path $Destination -Force | Out-Null }
            else {
                New-Item -ItemType Directory -Path (Split-Path -Parent $Destination) -Force | Out-Null
                [IO.Compression.ZipFileExtensions]::ExtractToFile($Entry,$Destination,$false)
            }
        }
    } finally { $Archive.Dispose() }
    $Manifest = Get-Content -LiteralPath (Join-Path $Package 'release.json') -Raw | ConvertFrom-Json
    if ($Manifest.component -ne 'server' -or $Manifest.version -ne $Version -or $Manifest.platform -ne 'windows-amd64') { throw 'Package component, version or platform does not match.' }
    foreach ($File in @('moniter.exe','web\dist\index.html','web\assets\world-map-paths.svg','install.sh','install.ps1','binaries\aegis-agent-linux-amd64','binaries\aegis-agent-linux-arm64','binaries\aegis-agent-windows-amd64')) { if (-not (Test-Path -LiteralPath (Join-Path $Package $File) -PathType Leaf)) { throw "Package is missing $File" } }
    $Reader = [IO.BinaryReader]::new([IO.File]::OpenRead((Join-Path $Package 'moniter.exe')))
    try {
        if ($Reader.ReadUInt16() -ne 0x5A4D) { throw 'Invalid Windows executable.' }
        $Reader.BaseStream.Position = 60; $Offset = $Reader.ReadUInt32(); $Reader.BaseStream.Position = $Offset
        if ($Reader.ReadUInt32() -ne 0x4550 -or $Reader.ReadUInt16() -ne 0x8664) { throw 'Expected a Windows amd64 executable.' }
    } finally { $Reader.Dispose() }
    if (Test-Path -LiteralPath (Join-Path $Root 'web\dist')) {
        # Keep only the immediately preceding build's dependency graph.
        $PreviousManifest = Join-Path $Root 'web\dist\build-manifest.json'
        $PreviousAssets = $null
        if (Test-Path -LiteralPath $PreviousManifest) {
            $PreviousAssets = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
            (Get-Content -LiteralPath $PreviousManifest -Raw | ConvertFrom-Json).PSObject.Properties | ForEach-Object {
                $Entry = $_.Value
                foreach ($Asset in @($Entry.file) + @($Entry.css) + @($Entry.assets)) {
                    if ($Asset) { [void]$PreviousAssets.Add([string]$Asset) }
                }
            }
        }
        Get-ChildItem -LiteralPath (Join-Path $Root 'web\dist') -File | Where-Object { $_.Name -match '^.+-[\w-]{8,}\.(js|css|woff2?|svg|png)$' -and -not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -and ($null -eq $PreviousAssets -or $PreviousAssets.Contains($_.Name)) } | ForEach-Object {
            $Destination = Join-Path (Join-Path $Package 'web\dist') $_.Name
            if (-not (Test-Path -LiteralPath $Destination)) { Copy-Item -LiteralPath $_.FullName -Destination $Destination }
        }
    }
    $Settings = @{}
    if ($HadConfig) { (Get-Content -LiteralPath $Config -Raw | ConvertFrom-Json).PSObject.Properties | ForEach-Object { $Settings[$_.Name] = [string]$_.Value } }
    if (-not $Settings.ContainsKey('AEGIS_BIND')) { $Settings['AEGIS_BIND']='0.0.0.0:8080' }
    $DbPath = Join-Path $Root 'data\probe.db'
    if ($Settings.ContainsKey('AEGIS_DB_PATH') -and [IO.Path]::GetFullPath($Settings['AEGIS_DB_PATH']) -ne $DbPath) { throw 'Keep the installer-managed AEGIS_DB_PATH, or use a manual deployment.' }
    $Settings['AEGIS_DB_PATH']=$DbPath
    if ($Port) { $Settings['AEGIS_BIND']=$Settings['AEGIS_BIND'] -replace ':\d+$',":$Port" }
    if ($Settings['AEGIS_BIND'] -notmatch '^(?<host>.+):(?<port>\d{1,5})$') { throw 'Invalid AEGIS_BIND.' }
    $ListenPort = [int]$Matches.port; $ListenHost = $Matches.host
    if ($ListenPort -lt 1 -or $ListenPort -gt 65535) { throw 'Invalid listening port.' }
    if ($ListenHost -in @('0.0.0.0','[::]','::')) { $ListenHost='127.0.0.1' }
    $Health = "http://${ListenHost}:$ListenPort/api/v1/ping"
    if (-not $Task) {
        $Listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Any,$ListenPort)
        try { $Listener.Start() } catch { throw 'The port is in use. Choose another with -Port.' } finally { $Listener.Stop() }
    }
    $Settings | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $Staging 'config.json') -Encoding UTF8
    $Backup = Join-Path $Root ('backups\' + (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ') + '-' + [guid]::NewGuid().ToString('N').Substring(0,8))
    foreach ($Directory in @("$Backup\payload","$Backup\database","$Root\data","$Root\web\themes","$Root\logs")) { New-Item -ItemType Directory -Path $Directory -Force | Out-Null }
    if ($HadConfig) { Copy-Item -LiteralPath $Config -Destination "$Backup\config.json" }
    if ($PreviousXml) { $PreviousXml | Set-Content -LiteralPath "$Backup\task.xml" -Encoding UTF8 }
    if ($Task) { Stop-MoniterProcess }
    $Stopped=$true
    foreach ($Suffix in @('','-wal','-shm')) { if (Test-Path -LiteralPath ($DbPath+$Suffix)) { Copy-Item -LiteralPath ($DbPath+$Suffix) -Destination "$Backup\database" } }
    $Changed=$true
    foreach ($Item in $Managed) {
        $Destination=Join-Path $Root $Item
        if (Test-Path -LiteralPath $Destination) { $Old=Join-Path "$Backup\payload" $Item; New-Item -ItemType Directory -Path (Split-Path -Parent $Old) -Force | Out-Null; Move-Item -LiteralPath $Destination -Destination $Old; $Saved.Add($Item) }
        if ($Item -ne 'run.ps1') { New-Item -ItemType Directory -Path (Split-Path -Parent $Destination) -Force | Out-Null; Move-Item -LiteralPath (Join-Path $Package $Item) -Destination $Destination; $Replaced.Add($Item) }
    }
    Move-Item -LiteralPath (Join-Path $Staging 'config.json') -Destination $Config -Force
    @'
$ErrorActionPreference='Stop'
$root=$PSScriptRoot
(Get-Content -LiteralPath (Join-Path $root 'moniter.json') -Raw | ConvertFrom-Json).PSObject.Properties | ForEach-Object {
    if ($_.Name -notmatch '^(AEGIS_[A-Z0-9_]+|MONITER_UPDATE_CHECK)$') { throw 'Invalid environment key in moniter.json.' }
    [Environment]::SetEnvironmentVariable($_.Name,[string]$_.Value,'Process')
}
# Copy raw UTF-8 bytes: Start-Process redirection otherwise depends on the
# Windows system code page, corrupting first-run credentials on English hosts.
$info=[Diagnostics.ProcessStartInfo]::new()
$info.FileName=Join-Path $root 'moniter.exe'; $info.WorkingDirectory=$root
$info.UseShellExecute=$false; $info.CreateNoWindow=$true
$info.RedirectStandardOutput=$true; $info.RedirectStandardError=$true
$process=[Diagnostics.Process]::new(); $process.StartInfo=$info
$stdout=[IO.FileStream]::new((Join-Path $root 'logs\server.out.log'),[IO.FileMode]::Create,[IO.FileAccess]::Write,[IO.FileShare]::Read,1,$true)
$stderr=[IO.FileStream]::new((Join-Path $root 'logs\server.err.log'),[IO.FileMode]::Create,[IO.FileAccess]::Write,[IO.FileShare]::Read,1,$true)
try {
    $process.Start() | Out-Null
    $outTask=$process.StandardOutput.BaseStream.CopyToAsync($stdout)
    $errTask=$process.StandardError.BaseStream.CopyToAsync($stderr)
    $process.WaitForExit()
    [Threading.Tasks.Task]::WaitAll([Threading.Tasks.Task[]]@($outTask,$errTask))
    $exitCode=$process.ExitCode
} finally { $stdout.Dispose(); $stderr.Dispose(); $process.Dispose() }
exit $exitCode
'@ | Set-Content -LiteralPath (Join-Path $Root 'run.ps1') -Encoding UTF8
    $Replaced.Add('run.ps1')
    $TaskAction=New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$Root\run.ps1`"" -WorkingDirectory $Root
    $Trigger=New-ScheduledTaskTrigger -AtStartup
    $Principal=New-ScheduledTaskPrincipal -UserId SYSTEM -LogonType ServiceAccount -RunLevel Highest
    $TaskSettings=New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
    Register-ScheduledTask -TaskName $TaskName -Action $TaskAction -Trigger $Trigger -Principal $Principal -Settings $TaskSettings -Force | Out-Null
    Start-ScheduledTask -TaskName $TaskName
    $Ready=$false
    for ($Attempt=0;$Attempt -lt 30;$Attempt++) {
        try {
            $Response=Invoke-WebRequest -UseBasicParsing -Uri $Health -TimeoutSec 2
            $Owned=@(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq (Join-Path $Root 'moniter.exe') })
            if ($Response.Content -eq 'pong' -and $Owned.Count -gt 0 -and (Get-ScheduledTask -TaskName $TaskName).State -eq 'Running') { $Ready=$true; break }
        } catch { }
        Start-Sleep -Seconds 1
    }
    if (-not $Ready) { throw 'The new version failed its startup check; restoring the previous installation.' }
    $Changed=$false; $Stopped=$false
    Write-Host "Moniter $Version installed and running. Startup task enabled."
    Write-Host "Public: http://<server-IP>:$ListenPort/"
    Write-Host "Admin:  http://<server-IP>:$ListenPort/admin"
    if (-not $HadDb) { Get-Content -LiteralPath (Join-Path $Root 'logs\server.out.log') -Encoding UTF8 | Where-Object { $_ -match '^\u7ba1\u7406\u5458(\u8d26\u53f7|\u5bc6\u7801):' } }
    Write-Host "Update: & '$Root\install.ps1' -Action update"
    Write-Host "Config: $Config"
    Write-Host "Logs: $Root\logs"
    Write-Host "Backup: $Backup"
} catch {
    $Failure=$_
    if ($Stopped) {
        Stop-MoniterProcess
        if ($Changed) {
            foreach ($Item in $Replaced) { $Target=Join-Path $Root $Item; if (Test-Path -LiteralPath $Target) { Remove-Item -LiteralPath $Target -Recurse -Force } }
            foreach ($Item in $Saved) { $Target=Join-Path $Root $Item; New-Item -ItemType Directory -Path (Split-Path -Parent $Target) -Force | Out-Null; Move-Item -LiteralPath (Join-Path "$Backup\payload" $Item) -Destination $Target -Force }
            foreach ($Suffix in @('','-wal','-shm')) { $Target=$DbPath+$Suffix; if (Test-Path -LiteralPath $Target) { Remove-Item -LiteralPath $Target -Force }; $Old=Join-Path "$Backup\database" ('probe.db'+$Suffix); if (Test-Path -LiteralPath $Old) { Copy-Item -LiteralPath $Old -Destination $Target } }
            if ($HadConfig) { Copy-Item -LiteralPath "$Backup\config.json" -Destination $Config -Force } elseif (Test-Path -LiteralPath $Config) { Remove-Item -LiteralPath $Config -Force }
            if ($PreviousXml) { Register-ScheduledTask -TaskName $TaskName -Xml $PreviousXml -Force | Out-Null } else { Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue }
        }
        if ($WasRunning) { Start-ScheduledTask -TaskName $TaskName }
        Write-Warning "Installation changes rolled back. Backup: $Backup"
    }
    throw $Failure
} finally {
    $Lock.Dispose()
    if ([IO.Path]::GetDirectoryName($Staging) -ne $Root) { throw 'Invalid staging path.' }
    Remove-Item -LiteralPath $Staging -Recurse -Force
}
}
if ($MyInvocation.InvocationName -ne '.') { Install-MoniterServer @PSBoundParameters }
