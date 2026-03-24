Pipcircuit MT5 History Service

Install on this PC:
1. Extract this folder anywhere.
2. Run install-mt5-service.cmd

That installs the helper to:
%LOCALAPPDATA%\Pipcircuit\mt5-history-service

It also registers a Windows logon task named:
Pipcircuit MT5 History Service

Remove it later:
- run uninstall-mt5-service.cmd

Notes:
- MetaTrader 5 must be installed on the PC.
- The helper serves on http://127.0.0.1:47831 by default.
- Logs are written to:
  %LOCALAPPDATA%\Pipcircuit\logs\mt5-history-service.log
