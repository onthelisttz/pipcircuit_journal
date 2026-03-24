param(
  [string]$TaskName = "Pipcircuit MT5 History Service"
)

$ErrorActionPreference = "Stop"
$installRoot = Join-Path $env:LOCALAPPDATA "Pipcircuit\mt5-history-service"

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Output "Removed scheduled task: $TaskName"
} else {
  Write-Output "Scheduled task not found: $TaskName"
}

if (Test-Path $installRoot) {
  Remove-Item $installRoot -Recurse -Force
  Write-Output "Removed installed MT5 service files: $installRoot"
}
