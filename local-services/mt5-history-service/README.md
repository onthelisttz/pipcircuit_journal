# MT5 Local Service

This helper runs on your computer and now starts both local backends together:

- the MT5 history service on `http://127.0.0.1:47831`
- the cTrader live service on `http://127.0.0.1:47832`

## Run

```bash
npm run mt5:service
```

Default URLs:

```text
http://127.0.0.1:47831
http://127.0.0.1:47832
```

## Start automatically on Windows

Build and install the packaged helper, then register a scheduled task that starts it when you sign in:

```bash
npm run mt5:service:install
```

Build the packaged helper without installing it:

```bash
npm run mt5:service:build
```

Create a distributable bundle for another PC:

```bash
npm run mt5:service:bundle
```

That creates:

```text
local-services/mt5-history-service/release/mt5-history-service-windows-x64/
local-services/mt5-history-service/release/mt5-history-service-windows-x64.zip
```

On another Windows PC, extract the zip and run:

```text
install-mt5-service.cmd
```

Remove it later if needed:

```bash
npm run mt5:service:uninstall
```

The install command copies these files into:

```text
%LOCALAPPDATA%\Pipcircuit\mt5-history-service\
```

The scheduled task runs this installed launcher:

```text
%LOCALAPPDATA%\Pipcircuit\mt5-history-service\start-mt5-service.cmd
```

The helper still writes logs to:

```text
%LOCALAPPDATA%\Pipcircuit\logs\mt5-history-service.log
```

## What it serves

- `GET /health`
- `GET /api/mt5/history/meta?rootPath=...`
- `GET /api/mt5/history/bars?symbol=NAS100&timeframe=M1&from=...&to=...&limit=...&rootPath=...`
- `POST /api/mt5/history/request-bars`

It also starts the cTrader live routes used by the synced chart live tab.

## Frontend setup

In the app Settings page:

- Set `Local service URL` to `http://127.0.0.1:47831`
- Set `History folder path` to your MT5 history folder
- Use `Request Latest Bars` to ask the helper to start MetaTrader 5 in the background if needed and pull more `M1` history from the last local bar forward

## Bundled bridge workflow

For the best end-user experience, build the MT5 request bridge into a standalone executable:

```bash
npm run mt5:bridge:build
```

That creates a bundled bridge binary in:

```text
local-services/mt5-history-service/bin/
```

When that binary exists, the packaged MT5 service installer copies it into the installed service directory automatically.
That means users do not need to install Python themselves.

## Optional env vars

- `MT5_LOCAL_SERVICE_HOST`
- `MT5_LOCAL_SERVICE_PORT`
- `MT5_HISTORY_ROOT`

## Development fallback

If you have not built the bundled bridge yet, the helper falls back to Python plus the official `MetaTrader5` package.

Install once:

```bash
python -m pip install MetaTrader5 pyinstaller
```
