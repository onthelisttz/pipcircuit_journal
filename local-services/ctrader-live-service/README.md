# cTrader Live Service

Local SSE bridge for the chart page live mode.

In normal use you do not need to start this separately anymore. It is started automatically by:

```bash
npm run mt5:service
```

## Run

```bash
npm run ctrader:live:service
```

Default URL:

```text
http://127.0.0.1:47832
```

The synced chart live toggle connects to this service, backfills missing completed bars, then overlays the current open candle from the live stream.
