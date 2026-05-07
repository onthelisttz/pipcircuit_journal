@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "LOG_ROOT=%LOCALAPPDATA%\Pipcircuit\logs"
if not exist "%LOG_ROOT%" mkdir "%LOG_ROOT%" >nul 2>&1
set "LOG_FILE=%LOG_ROOT%\mt5-history-service.log"
set "PACKAGED_EXE=%SCRIPT_DIR%mt5-history-service.exe"

if exist "%PACKAGED_EXE%" (
  set "PIPCIRCUIT_MT5_SERVICE_DIR=%SCRIPT_DIR%"
  set "PIPCIRCUIT_CONFIG_DIR=%SCRIPT_DIR%"
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$healthUrl='http://127.0.0.1:47831/health';" ^
    "try { $health = Invoke-RestMethod -UseBasicParsing $healthUrl -TimeoutSec 2; if ($health.ok -and $health.services.ctraderLive.ok) { exit 0 } } catch {};" ^
    "$env:PIPCIRCUIT_MT5_SERVICE_DIR='%PIPCIRCUIT_MT5_SERVICE_DIR:\=\\%';" ^
    "Start-Process -WindowStyle Hidden -FilePath '%PACKAGED_EXE:\=\\%' -ArgumentList '--serve' | Out-Null;" ^
    "exit 0"
  exit /b %ERRORLEVEL%
) else (
  for %%I in ("%SCRIPT_DIR%..\..") do set "REPO_ROOT=%%~fI"
  set "RUN_COMMAND=cd /d ""%REPO_ROOT%"" && npm.cmd run mt5:service"
)

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$healthUrl='http://127.0.0.1:47831/health';" ^
  "try { $health = Invoke-RestMethod -UseBasicParsing $healthUrl -TimeoutSec 2; if ($health.ok -and $health.services.ctraderLive.ok) { exit 0 } } catch {};" ^
  "$env:PIPCIRCUIT_MT5_SERVICE_DIR='%PIPCIRCUIT_MT5_SERVICE_DIR:\=\\%';" ^
  "$env:PIPCIRCUIT_CONFIG_DIR='%SCRIPT_DIR:\=\\%';" ^
  "$log='%LOG_FILE:\=\\%';" ^
  "$command='%RUN_COMMAND:"=\"%' + ' >> ""' + $log + '"" 2>&1';" ^
  "Start-Process -WindowStyle Hidden -FilePath 'cmd.exe' -ArgumentList '/c', $command | Out-Null;" ^
  "exit 0"

exit /b %ERRORLEVEL%
