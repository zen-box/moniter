$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$file=Join-Path $root 'server/src/install.ps1'
$tokens=$null; $parseErrors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($file,[ref]$tokens,[ref]$parseErrors)
if($parseErrors.Count -gt 0){throw ($parseErrors | ForEach-Object Message | Out-String)}
$commands=$ast.FindAll({param($node) $node -is [Management.Automation.Language.CommandAst]},$true)
function Require-Command([string]$name,[string[]]$fragments){
  $matches=@($commands | Where-Object {$_.GetCommandName() -eq $name})
  if(-not $matches.Count){throw "Missing installer command $name"}
  foreach($fragment in $fragments){if(-not @($matches|Where-Object {$_.Extent.Text.Contains($fragment)}).Count){throw "Missing $name parameter $fragment"}}
}
Require-Command 'New-ScheduledTaskTrigger' @('-AtStartup')
Require-Command 'New-ScheduledTaskPrincipal' @("-UserId 'SYSTEM'",'-LogonType ServiceAccount','-RunLevel Highest')
Require-Command 'New-ScheduledTaskSettingsSet' @('-ExecutionTimeLimit ([TimeSpan]::Zero)','-StartWhenAvailable','-AllowStartIfOnBatteries','-DontStopIfGoingOnBatteries','-MultipleInstances IgnoreNew')
Require-Command 'Move-Item' @('-LiteralPath $Download','-Destination $Exe','-LiteralPath $PreparedToken')
Require-Command 'icacls' @('$Staging /inheritance:r','$TokenFile /inheritance:r')
$result=@{syntax='passed';task_parameters='passed';installs_executed=$false;note='AST and command parameter verification only; reboot and long-running behavior require a dedicated Windows host.'}
$result|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $root '.ui-review/windows-installer-round2.json')
$result|ConvertTo-Json -Compress
