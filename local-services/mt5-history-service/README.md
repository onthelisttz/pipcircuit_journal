# MT5 Local Service

This helper runs on your computer and exposes the same MT5 history routes the frontend already expects.

## Run

```bash
npm run mt5:service
```

Default URL:

```text
http://127.0.0.1:47831
```

## What it serves

- `GET /health`
- `GET /api/mt5/history/meta?rootPath=...`
- `GET /api/mt5/history/bars?symbol=NAS100&timeframe=M1&from=...&to=...&limit=...&rootPath=...`
- `POST /api/mt5/history/request-bars`

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

When that binary exists, the helper uses it automatically.
That means users only need to run the service, not install Python themselves.

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
