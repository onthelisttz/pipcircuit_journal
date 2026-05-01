"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ChartBar, ChartTimeframe } from "@domain/entities";
import { CTraderAPI } from "@infrastructure/api/ctrader";
import {
  DexieChartBarRepository,
  DexieSettingsRepository,
  DexieSymbolSyncProgressRepository,
} from "@infrastructure/db/dexie/repositories";
import {
  buildLocalServiceEndpoint,
  CTRADER_LIVE_SERVICE_URL_SETTING_KEY,
  DEFAULT_CTRADER_LIVE_SERVICE_URL,
} from "@lib/ctrader-live";
import { CTraderMapper } from "@infrastructure/api/ctrader/CTraderMapper";
import { progressEventEmitter } from "@infrastructure/sync/ProgressEventEmitter";
import type { SymbolSyncProgress } from "@domain/entities";

const TIMEFRAME_TO_MS: Record<ChartTimeframe, number> = {
  M1: 60_000,
  M5: 5 * 60_000,
  M15: 15 * 60_000,
  M30: 30 * 60_000,
  H1: 60 * 60_000,
  H4: 4 * 60 * 60_000,
  D1: 24 * 60 * 60_000,
};

export type LiveChartStatus =
  | "idle"
  | "backfilling"
  | "connecting"
  | "live"
  | "error";

interface UseCTraderLiveBarOptions {
  enabled: boolean;
  symbol?: string | null;
  broker?: string | null;
  timeframe: ChartTimeframe;
  accessToken?: string;
  accountNumber?: string | null;
}

interface LiveQuote {
  bid?: number;
  ask?: number;
  spotTimestamp?: number;
}

export interface LivePositionSnapshot {
  positionId: string;
  symbol: string;
  direction: "Buy" | "Sell";
  volume: number;
  lots: number;
  openTimestamp: number | null;
  entryPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  trailingStopLoss: boolean;
  label: string;
  comment: string;
  updatedAt: number | null;
}

export interface LiveOrderSnapshot {
  orderId: string;
  symbol: string;
  direction: "Buy" | "Sell";
  orderType: string;
  lots: number;
  volume: number;
  limitPrice: number | null;
  stopPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  createdAt: number | null;
  expiresAt: number | null;
  positionId: number | null;
}

interface UseCTraderLiveBarResult {
  currentBar: ChartBar | null;
  quote: LiveQuote | null;
  positions: LivePositionSnapshot[];
  orders: LiveOrderSnapshot[];
  status: LiveChartStatus;
  error: string | null;
  backfillCompletedAt: number | null;
  sessionId: string | null;
  serviceUrl: string;
}

function floorTimestamp(timestamp: number, timeframe: ChartTimeframe): number {
  if (timeframe === "D1") {
    const date = new Date(timestamp);
    date.setUTCHours(0, 0, 0, 0);
    return date.getTime();
  }

  const interval = TIMEFRAME_TO_MS[timeframe];
  return Math.floor(timestamp / interval) * interval;
}

function buildBarFromTicks(
  ticks: Array<{ timestamp: number; price: number }>,
  timeframe: ChartTimeframe,
  broker: string,
  symbol: string
): ChartBar | null {
  if (ticks.length === 0) return null;

  const sorted = [...ticks].sort((left, right) => left.timestamp - right.timestamp);
  const bucketTimestamp = floorTimestamp(sorted[0].timestamp, timeframe);
  const prices = sorted.map((tick) => tick.price);

  return {
    broker,
    symbol,
    timeframe,
    timestamp: bucketTimestamp,
    open: prices[0],
    high: Math.max(...prices),
    low: Math.min(...prices),
    close: prices[prices.length - 1],
    volume: sorted.length,
  };
}

function mergeQuoteIntoBar(params: {
  existingBar: ChartBar | null;
  seededBar?: ChartBar | null;
  timeframe: ChartTimeframe;
  broker: string;
  symbol: string;
  price?: number;
  timestamp?: number;
}): ChartBar | null {
  const {
    existingBar,
    seededBar,
    timeframe,
    broker,
    symbol,
    price,
    timestamp,
  } = params;

  const baseBar = seededBar ?? existingBar;
  if (price == null || !Number.isFinite(price)) {
    return baseBar ?? null;
  }

  const eventTimestamp = timestamp ?? Date.now();
  const bucketTimestamp = floorTimestamp(eventTimestamp, timeframe);

  if (!baseBar || baseBar.timestamp !== bucketTimestamp) {
    return {
      broker,
      symbol,
      timeframe,
      timestamp: bucketTimestamp,
      open: price,
      high: price,
      low: price,
      close: price,
      volume: Math.max(1, baseBar?.volume ?? 0),
    };
  }

  return {
    ...baseBar,
    high: Math.max(baseBar.high, price),
    low: Math.min(baseBar.low, price),
    close: price,
    volume: Math.max(baseBar.volume, 1),
  };
}

export function useCTraderLiveBar({
  enabled,
  symbol,
  broker,
  timeframe,
  accessToken,
  accountNumber,
}: UseCTraderLiveBarOptions): UseCTraderLiveBarResult {
  const [serviceUrl, setServiceUrl] = useState(DEFAULT_CTRADER_LIVE_SERVICE_URL);
  const [currentBar, setCurrentBar] = useState<ChartBar | null>(null);
  const [quote, setQuote] = useState<LiveQuote | null>(null);
  const [positions, setPositions] = useState<LivePositionSnapshot[]>([]);
  const [orders, setOrders] = useState<LiveOrderSnapshot[]>([]);
  const [status, setStatus] = useState<LiveChartStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [backfillCompletedAt, setBackfillCompletedAt] = useState<number | null>(null);
  const [sessionIdState, setSessionIdState] = useState<string | null>(null);

  const previousBarRef = useRef<ChartBar | null>(null);
  const lastLiveEventAtRef = useRef(0);
  const apiRef = useRef(new CTraderAPI());
  const chartRepoRef = useRef(new DexieChartBarRepository());
  const progressRepoRef = useRef(new DexieSymbolSyncProgressRepository());
  const key = useMemo(
    () => `${broker ?? ""}:${symbol ?? ""}:${timeframe}:${accountNumber ?? ""}`,
    [accountNumber, broker, symbol, timeframe]
  );

  useEffect(() => {
    const repo = new DexieSettingsRepository();
    let cancelled = false;

    void repo.get(CTRADER_LIVE_SERVICE_URL_SETTING_KEY).then((record) => {
      if (cancelled) return;
      const nextUrl =
        typeof record?.value === "string"
          ? record.value.trim()
          : DEFAULT_CTRADER_LIVE_SERVICE_URL;
      setServiceUrl(nextUrl || DEFAULT_CTRADER_LIVE_SERVICE_URL);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!enabled || !symbol || !broker || !accessToken || !accountNumber) {
      previousBarRef.current = null;
      setCurrentBar(null);
      setQuote(null);
      setPositions([]);
      setOrders([]);
      setStatus("idle");
      setError(null);
      setSessionIdState(null);
      return;
    }

    const chartRepo = chartRepoRef.current;
    const progressRepo = progressRepoRef.current;
    const api = apiRef.current;
    const effectiveServiceUrl = serviceUrl || DEFAULT_CTRADER_LIVE_SERVICE_URL;
    const normalizedSymbol = symbol.trim();
    let cancelled = false;
    let eventSource: EventSource | null = null;
    let sessionId: string | null = null;
    let fallbackTimer: number | null = null;

    const refreshLocalProgressMetadata = async () => {
      try {
        const [dates, totalBars, existingProgress] = await Promise.all([
          chartRepo.getDateRange(broker, normalizedSymbol, "M1"),
          chartRepo.countBars(broker, normalizedSymbol, "M1"),
          progressRepo.getByBrokerAndSymbol(broker, normalizedSymbol),
        ]);

        const nextProgress: SymbolSyncProgress = {
          id: existingProgress?.id,
          broker,
          symbol: normalizedSymbol,
          status: totalBars > 0 ? "completed" : existingProgress?.status ?? "pending",
          totalBars,
          firstBarDate: dates.firstBarDate,
          lastBarDate: dates.lastBarDate,
          lastSyncTime: new Date(),
          error: null,
          progressPercent: totalBars > 0 ? 100 : existingProgress?.progressPercent,
          currentFetchFrom: null,
          currentFetchTo: null,
          currentFetchStartedAt: null,
        };

        await progressRepo.upsert(nextProgress);
        progressEventEmitter.emit(nextProgress);
      } catch (metadataError) {
        console.warn(
          "[useCTraderLiveBar] Failed to refresh symbol sync progress metadata:",
          metadataError
        );
      }
    };

    const persistCompletedBar = async (bar: ChartBar | null) => {
      if (!bar) return;
      try {
        await chartRepo.upsertMany([bar]);
        await refreshLocalProgressMetadata();
      } catch (persistError) {
        console.warn("[useCTraderLiveBar] Failed to persist completed live bar:", persistError);
      }
    };

    const applyPayload = (payload: unknown) => {
      if (cancelled || !payload || typeof payload !== "object") return;

      const next = payload as {
        type?: string;
        bid?: number;
        ask?: number;
        spotTimestamp?: number;
        positions?: LivePositionSnapshot[];
        orders?: LiveOrderSnapshot[];
        currentBar?: {
          timestamp: number;
          open: number;
          high: number;
          low: number;
          close: number;
          volume: number;
        } | null;
      };

      if (next.type === "snapshot") {
        setPositions(Array.isArray(next.positions) ? next.positions : []);
        setOrders(Array.isArray(next.orders) ? next.orders : []);
        setError(null);
        return;
      }

      if (next.type === "alert-fired") {
        return;
      }

      const livePrice =
        typeof next.bid === "number"
          ? next.bid
          : typeof next.ask === "number"
            ? next.ask
            : undefined;
      const spotTimestamp =
        typeof next.spotTimestamp === "number" ? next.spotTimestamp : Date.now();

      setQuote({
        bid: next.bid,
        ask: next.ask,
        spotTimestamp,
      });
      lastLiveEventAtRef.current = Date.now();

      const previousBar = previousBarRef.current;
      const seededBar = next.currentBar
        ? {
            broker,
            symbol: normalizedSymbol,
            timeframe,
            timestamp: Number(next.currentBar.timestamp),
            open: Number(next.currentBar.open),
            high: Number(next.currentBar.high),
            low: Number(next.currentBar.low),
            close: Number(next.currentBar.close),
            volume: Number(next.currentBar.volume),
          }
        : null;
      const liveBar = mergeQuoteIntoBar({
        existingBar: previousBar,
        seededBar,
        timeframe,
        broker,
        symbol: normalizedSymbol,
        price: livePrice,
        timestamp: spotTimestamp,
      });

      if (!liveBar) {
        setStatus("live");
        setError(null);
        return;
      }

      if (previousBar && liveBar.timestamp > previousBar.timestamp) {
        void persistCompletedBar(previousBar);
      }

      previousBarRef.current = liveBar;
      setCurrentBar(liveBar);
      setStatus("live");
      setError(null);
    };

    const connect = async () => {
      try {
        lastLiveEventAtRef.current = 0;
        setStatus("backfilling");
        setError(null);

        const range = await chartRepo.getDateRange(broker, normalizedSymbol, timeframe);
        const intervalMs = TIMEFRAME_TO_MS[timeframe];
        const currentBucketStart = floorTimestamp(Date.now(), timeframe);
        const latestLocalTimestamp = range.lastBarDate?.getTime() ?? null;
        const backfillFrom =
          latestLocalTimestamp != null ? latestLocalTimestamp + intervalMs : null;
        const backfillTo = currentBucketStart - intervalMs;

        if (
          backfillFrom != null &&
          Number.isFinite(backfillFrom) &&
          backfillFrom <= backfillTo
        ) {
          const bars = await api.getBars(
            accessToken,
            normalizedSymbol,
            timeframe,
            backfillFrom,
            backfillTo,
            accountNumber
          );
          if (bars.length > 0) {
            const mappedBars = bars.map((bar) => ({
              ...CTraderMapper.toChartBar(bar),
              broker,
            }));
            await chartRepo.upsertMany(mappedBars);
            await refreshLocalProgressMetadata();
            if (!cancelled) {
              setBackfillCompletedAt(Date.now());
            }
          }
        } else if (!cancelled) {
          setBackfillCompletedAt(Date.now());
        }

        if (cancelled) return;

        setStatus("connecting");
        const sessionResponse = await fetch(
          buildLocalServiceEndpoint("/api/ctrader/live/session", effectiveServiceUrl),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              accessToken,
              accountNumber,
              symbol: normalizedSymbol,
              timeframe,
            }),
          }
        );

        const sessionPayload = (await sessionResponse.json()) as {
          sessionId?: string;
          state?: string;
          error?: string | null;
          snapshot?: unknown;
        };

        if (!sessionResponse.ok || !sessionPayload.sessionId) {
          throw new Error(
            sessionPayload.error ??
              `Failed to create live session (${sessionResponse.status})`
          );
        }

        sessionId = sessionPayload.sessionId;
        setSessionIdState(sessionId);
        if (sessionPayload.state === "live") {
          setStatus("live");
          setError(null);
        }
        if (sessionPayload.snapshot) {
          applyPayload(sessionPayload.snapshot);
        }

        eventSource = new EventSource(
          buildLocalServiceEndpoint(
            `/api/ctrader/live/stream?sessionId=${encodeURIComponent(sessionId)}`,
            effectiveServiceUrl
          )
        );

        eventSource.addEventListener("status", (event) => {
          if (cancelled) return;
          try {
            const payload = JSON.parse((event as MessageEvent).data) as {
              state?: LiveChartStatus;
              error?: string | null;
            };
            if (payload.state) {
              setStatus(payload.state);
            }
            setError(payload.error ?? null);
          } catch {
            // ignore malformed status payloads
          }
        });

        const handleMessage = (event: MessageEvent) => {
          try {
            applyPayload(JSON.parse(event.data));
          } catch (parseError) {
            console.warn("[useCTraderLiveBar] Failed to parse live payload:", parseError);
          }
        };
        eventSource.onmessage = handleMessage;

        eventSource.onerror = () => {
          if (cancelled) return;
          setStatus("error");
          setError(
            `Could not reach the local cTrader live service at ${effectiveServiceUrl}. Start it with \`npm run ctrader:live:service\`.`
          );
        };

        fallbackTimer = window.setInterval(async () => {
          if (cancelled) return;

          const staleForMs = Date.now() - lastLiveEventAtRef.current;
          if (lastLiveEventAtRef.current !== 0 && staleForMs < 5_000) {
            return;
          }

          try {
            if (!sessionId) return;
            const currentBucketStart = floorTimestamp(Date.now(), timeframe);
            const ticksResponse = await fetch(
              buildLocalServiceEndpoint(
                `/api/ctrader/live/ticks?sessionId=${encodeURIComponent(
                  sessionId
                )}&from=${currentBucketStart}&to=${Date.now()}`,
                effectiveServiceUrl
              )
            );
            const ticksPayload = (await ticksResponse.json()) as {
              bidTicks?: Array<{ timestamp: number; price: number }>;
              askTicks?: Array<{ timestamp: number; price: number }>;
              error?: string;
            };

            if (!ticksResponse.ok) {
              throw new Error(
                ticksPayload.error ?? `Failed to poll live ticks (${ticksResponse.status})`
              );
            }

            if (cancelled) return;

            const bidTicks = Array.isArray(ticksPayload.bidTicks)
              ? ticksPayload.bidTicks
              : [];
            const askTicks = Array.isArray(ticksPayload.askTicks)
              ? ticksPayload.askTicks
              : [];

            const liveBar = buildBarFromTicks(
              bidTicks,
              timeframe,
              broker,
              normalizedSymbol
            );
            if (!liveBar) return;

            const previousBar = previousBarRef.current;
            if (previousBar && liveBar.timestamp > previousBar.timestamp) {
              void persistCompletedBar(previousBar);
            }

            previousBarRef.current = liveBar;
            setCurrentBar(liveBar);
            setQuote({
              bid: bidTicks[bidTicks.length - 1]?.price,
              ask: askTicks[askTicks.length - 1]?.price,
              spotTimestamp:
                bidTicks[bidTicks.length - 1]?.timestamp ??
                askTicks[askTicks.length - 1]?.timestamp,
            });
            setStatus("live");
            setError(null);
          } catch {
            // Ignore fallback polling errors; SSE remains the primary live path.
          }
        }, 3_000);
      } catch (connectError) {
        if (cancelled) return;
        setStatus("error");
        setError(
          connectError instanceof Error ? connectError.message : "Failed to start live mode."
        );
        setSessionIdState(null);
      }
    };

    void connect();

    return () => {
      cancelled = true;
      if (eventSource) {
        eventSource.close();
      }
      if (fallbackTimer != null) {
        window.clearInterval(fallbackTimer);
      }
      if (sessionId) {
        void fetch(
          buildLocalServiceEndpoint(
            `/api/ctrader/live/session?sessionId=${encodeURIComponent(sessionId)}`,
            effectiveServiceUrl
          ),
          { method: "DELETE" }
        ).catch(() => {});
      }
      setSessionIdState(null);
    };
  }, [accessToken, accountNumber, broker, enabled, key, serviceUrl, symbol, timeframe]);

  return {
    currentBar,
    quote,
    positions,
    orders,
    status,
    error,
    backfillCompletedAt,
    sessionId: sessionIdState,
    serviceUrl,
  };
}
