$ErrorActionPreference = 'Stop'
$Token = __TOKEN__
$Base = __BASE__
$WsBase = __WS_BASE__
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { throw '请以管理员身份运行 PowerShell' }
$InstallDir = Join-Path $env:ProgramFiles 'MoniterAgent'
New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
$Exe = Join-Path $InstallDir 'aegis-agent.exe'
$TokenFile = Join-Path $InstallDir 'agent.token'
$Staging = Join-Path $InstallDir ([guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $Staging | Out-Null
& icacls $Staging /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)(F)' '*S-1-5-32-544:(OI)(CI)(F)' | Out-Null
if ($LASTEXITCODE -ne 0) { throw '无法保护安装临时目录' }
$Download = Join-Path $Staging 'agent.exe'
$Existing = Get-ScheduledTask -TaskName 'MoniterAgent' -ErrorAction SilentlyContinue
$Legacy = Get-ScheduledTask -TaskName 'AntoxAgent' -ErrorAction SilentlyContinue
$PreviousXml = if ($Existing) { Export-ScheduledTask -TaskName 'MoniterAgent' } else { $null }
$HadExe = Test-Path -LiteralPath $Exe
$HadToken = Test-Path -LiteralPath $TokenFile
$Changed = $false
try {
    Invoke-WebRequest -UseBasicParsing -Uri "$Base/download/agent/windows-amd64" -OutFile $Download -TimeoutSec 120
    $stream = [IO.File]::OpenRead($Download)
    try { if ($stream.ReadByte() -ne 77 -or $stream.ReadByte() -ne 90) { throw '下载文件不是有效的 Windows 程序' } } finally { $stream.Dispose() }
    if ($HadExe) { Copy-Item -LiteralPath $Exe -Destination (Join-Path $Staging 'previous.exe') }
    if ($HadToken) { Copy-Item -LiteralPath $TokenFile -Destination (Join-Path $Staging 'token.previous') }
    $Changed = $true
    foreach ($task in @($Existing, $Legacy)) { if ($task) { Stop-ScheduledTask -InputObject $task -ErrorAction SilentlyContinue } }
    # Task termination is asynchronous; wait for the exact installed executable.
    $deadline = (Get-Date).AddSeconds(15)
    while (Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $Exe }) {
        if ((Get-Date) -gt $deadline) { throw 'Agent 未能停止，请稍后重试' }
        Start-Sleep -Milliseconds 250
    }
    Move-Item -LiteralPath $Download -Destination $Exe -Force
    $PreparedToken = Join-Path $Staging 'new.token'
    Set-Content -LiteralPath $PreparedToken -Value $Token -NoNewline
    Move-Item -LiteralPath $PreparedToken -Destination $TokenFile -Force
    & icacls $TokenFile /inheritance:r /grant:r '*S-1-5-18:(F)' '*S-1-5-32-544:(F)' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw '无法限制令牌文件权限' }
    $Action = New-ScheduledTaskAction -Execute $Exe -Argument "--server $WsBase/ws/agent --token-file `"$TokenFile`""
    $Trigger = New-ScheduledTaskTrigger -AtStartup
    $Principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    $Settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
    Register-ScheduledTask -TaskName 'MoniterAgent' -Action $Action -Trigger $Trigger -Principal $Principal -Settings $Settings -Force | Out-Null
    Start-ScheduledTask -TaskName 'MoniterAgent'
    $startDeadline = (Get-Date).AddSeconds(10)
    while ((Get-ScheduledTask -TaskName 'MoniterAgent').State -ne 'Running') {
        if ((Get-Date) -gt $startDeadline) { throw 'Agent 任务未能保持运行，安装将回滚' }
        Start-Sleep -Milliseconds 500
    }
    if ($Legacy) { Unregister-ScheduledTask -InputObject $Legacy -Confirm:$false }
    $Changed = $false
    Write-Host '安装完成，Agent 已设置为系统启动时运行，无需登录，无运行时限'
} catch {
    $failure = $_
    if ($Changed) {
        Stop-ScheduledTask -TaskName 'MoniterAgent' -ErrorAction SilentlyContinue
        if ($HadExe) { Copy-Item -LiteralPath (Join-Path $Staging 'previous.exe') -Destination $Exe -Force }
        elseif (Test-Path -LiteralPath $Exe) { Remove-Item -LiteralPath $Exe -Force }
        if ($HadToken) { Copy-Item -LiteralPath (Join-Path $Staging 'token.previous') -Destination $TokenFile -Force }
        elseif (Test-Path -LiteralPath $TokenFile) { Remove-Item -LiteralPath $TokenFile -Force }
        if ($PreviousXml) { Register-ScheduledTask -TaskName 'MoniterAgent' -Xml $PreviousXml -Force | Out-Null; Start-ScheduledTask -TaskName 'MoniterAgent' }
        else { Unregister-ScheduledTask -TaskName 'MoniterAgent' -Confirm:$false -ErrorAction SilentlyContinue }
        if ($Legacy) { Start-ScheduledTask -InputObject $Legacy }
    }
    throw $failure
} finally {
    if ((Split-Path -Parent $Staging) -ne $InstallDir) { throw '安装临时目录无效' }
    Remove-Item -LiteralPath $Staging -Recurse -Force
}
