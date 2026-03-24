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

## Frontend setup

In the app Settings page:

- Set `Local service URL` to `http://127.0.0.1:47831`
- Set `History folder path` to your MT5 history folder

## Optional env vars

- `MT5_LOCAL_SERVICE_HOST`
- `MT5_LOCAL_SERVICE_PORT`
- `MT5_HISTORY_ROOT`
