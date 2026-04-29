# cTrader Live Service

Local SSE bridge for the chart page live mode.

## Run

```bash
npm run ctrader:live:service
```

Default URL:

```text
http://127.0.0.1:47832
```

The synced chart live toggle connects to this service, backfills missing completed bars, then overlays the current open candle from the live stream.
