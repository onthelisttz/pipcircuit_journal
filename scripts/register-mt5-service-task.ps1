param(
  [string]$TaskName = "Pipcircuit MT5 History Service"
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$buildRoot = Join-Path $repoRoot "local-services\mt5-history-service\dist"
$serviceExePath = Join-Path $buildRoot "mt5-history-service.exe"
$bridgePath = Join-Path $buildRoot "bin\request_mt5_bars.exe"
$launcherSourcePath = Join-Path $repoRoot "local-services\mt5-history-service\start-mt5-service.cmd"
$installRoot = Join-Path $env:LOCALAPPDATA "Pipcircuit\mt5-history-service"
$installBinRoot = Join-Path $installRoot "bin"
$launcherPath = Join-Path $installRoot "start-mt5-service.cmd"

foreach ($requiredPath in @($serviceExePath, $bridgePath, $launcherSourcePath)) {
  if (-not (Test-Path $requiredPath)) {
    throw "Required MT5 service artifact not found: $requiredPath"
  }
}

New-Item -ItemType Directory -Path $installBinRoot -Force | Out-Null
Copy-Item $serviceExePath (Join-Path $installRoot "mt5-history-service.exe") -Force
Copy-Item $bridgePath (Join-Path $installBinRoot "request_mt5_bars.exe") -Force
Copy-Item $launcherSourcePath $launcherPath -Force

$userId = if ($env:USERDOMAIN) {
  "$($env:USERDOMAIN)\$($env:USERNAME)"
} else {
  $env:USERNAME
}

$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$launcherPath`"" -WorkingDirectory $installRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Principal $principal `
  -Force | Out-Null

Start-ScheduledTask -TaskName $TaskName
Write-Output "Installed MT5 service to: $installRoot"
Write-Output "Registered and started scheduled task: $TaskName"
