"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ChartBar, ChartTimeframe } from "@domain/entities";
import { CTraderAPI } from "@infrastructure/api/ctrader";
import {
  DexieChartBarRepository,
  DexieSettingsRepository,
  DexieSymbolSyncProgressRepository,
} from "@infrastructure/db/dexie/repositories";
import { HybridSyncChartBarsUseCase } from "@application/use-cases/sync";
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
const LIVE_SERVER_REPAIR_BARS = 512;
const LIVE_M1_REPAIR_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

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

export interface LiveAlertTriggerEvent {
  id: string;
  alertId: string;
  broker: string;
  symbol: string;
  condition: "above" | "below";
  priceSide: "bid" | "ask";
  targetPrice: number;
  triggerPrice: number;
  note: string | null;
  firedAt: string;
}

interface UseCTraderLiveBarResult {
  currentBar: ChartBar | null;
  quote: LiveQuote | null;
  positions: LivePositionSnapshot[];
  orders: LiveOrderSnapshot[];
  latestAlertEvent: LiveAlertTriggerEvent | null;
  status: LiveChartStatus;
  error: string | null;
  backfillCompletedAt: number | null;
  sessionId: string | null;
  serviceUrl: string;
}

function normalizeSymbol(symbol?: string | null): string {
  return String(symbol ?? "").replace("/", "").trim().toUpperCase();
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

function getMinimumReasonablePrice(symbol?: string | null): number {
  const normalized = normalizeSymbol(symbol);
  if (normalized === "XAUUSD" || normalized === "GOLD") {
    return 1;
  }
  if (normalized === "XAGUSD" || normalized === "SILVER") {
    return 0.1;
  }
  if (/^[A-Z]{6}$/.test(normalized)) {
    return 0.01;
  }
  return 0.0001;
}

function isPriceReasonableAgainstAnchor(price: number, anchorPrice?: number): boolean {
  if (!Number.isFinite(anchorPrice) || anchorPrice == null || anchorPrice <= 0) {
    return true;
  }
  return price >= anchorPrice * 0.2 && price <= anchorPrice * 5;
}

function sanitizeLivePrice(
  price: number | null | undefined,
  symbol?: string | null,
  anchorPrice?: number
): number | undefined {
  if (price == null || !Number.isFinite(price) || price <= 0) {
    return undefined;
  }
  if (price < getMinimumReasonablePrice(symbol)) {
    return undefined;
  }
  if (!isPriceReasonableAgainstAnchor(price, anchorPrice)) {
    return undefined;
  }
  return price;
}

function getReferencePriceFromQuote(quote: LiveQuote | null | undefined): number | undefined {
  return sanitizeLivePrice(quote?.bid) ?? sanitizeLivePrice(quote?.ask);
}

function isStructurallyValidBar(bar: ChartBar | null | undefined): bar is ChartBar {
  if (!bar) return false;
  if (
    !Number.isFinite(bar.timestamp) ||
    !Number.isFinite(bar.open) ||
    !Number.isFinite(bar.high) ||
    !Number.isFinite(bar.low) ||
    !Number.isFinite(bar.close) ||
    !Number.isFinite(bar.volume)
  ) {
    return false;
  }
  if (bar.open <= 0 || bar.high <= 0 || bar.low <= 0 || bar.close <= 0) {
    return false;
  }
  if (bar.high < bar.low) {
    return false;
  }
  if (bar.open < bar.low || bar.open > bar.high) {
    return false;
  }
  if (bar.close < bar.low || bar.close > bar.high) {
    return false;
  }
  return true;
}

function sanitizeLiveBar(
  bar: ChartBar | null | undefined,
  symbol?: string | null,
  anchorPrice?: number
): ChartBar | null {
  if (!isStructurallyValidBar(bar)) {
    return null;
  }

  const prices = [bar.open, bar.high, bar.low, bar.close];
  if (prices.some((price) => sanitizeLivePrice(price, symbol, anchorPrice) == null)) {
    return null;
  }

  return bar;
}

function sanitizeTickSeries(
  ticks: Array<{ timestamp: number; price: number }>,
  symbol?: string | null,
  initialAnchorPrice?: number
): Array<{ timestamp: number; price: number }> {
  let anchorPrice = initialAnchorPrice;

  return [...ticks]
    .filter(
      (tick) =>
        Number.isFinite(tick?.timestamp) &&
        Number.isFinite(tick?.price)
    )
    .sort((left, right) => left.timestamp - right.timestamp)
    .reduce<Array<{ timestamp: number; price: number }>>((next, tick) => {
      const sanitizedPrice = sanitizeLivePrice(tick.price, symbol, anchorPrice);
      if (sanitizedPrice == null) {
        return next;
      }
      anchorPrice = sanitizedPrice;
      next.push({
        timestamp: tick.timestamp,
        price: sanitizedPrice,
      });
      return next;
    }, []);
}

function buildBarFromTicks(
  ticks: Array<{ timestamp: number; price: number }>,
  timeframe: ChartTimeframe,
  broker: string,
  symbol: string
): ChartBar | null {
  const sorted = ticks
    .filter(
      (tick) =>
        Number.isFinite(tick?.timestamp) &&
        Number.isFinite(tick?.price) &&
        tick.price > 0
    )
    .sort((left, right) => left.timestamp - right.timestamp);
  if (sorted.length === 0) return null;
  const bucketTimestamp = floorTimestamp(sorted[0].timestamp, timeframe);
  const prices = sorted.map((tick) => tick.price);

  return sanitizeLiveBar({
    broker,
    symbol,
    timeframe,
    timestamp: bucketTimestamp,
    open: prices[0],
    high: Math.max(...prices),
    low: Math.min(...prices),
    close: prices[prices.length - 1],
    volume: sorted.length,
  }, symbol, prices[prices.length - 1]);
}

function buildBarsFromTicksRange(
  ticks: Array<{ timestamp: number; price: number }>,
  timeframe: ChartTimeframe,
  broker: string,
  symbol: string
): ChartBar[] {
  if (ticks.length === 0) return [];

  const buckets = new Map<number, Array<{ timestamp: number; price: number }>>();
  for (const tick of ticks) {
    if (!Number.isFinite(tick?.timestamp) || !Number.isFinite(tick?.price) || tick.price <= 0) {
      continue;
    }
    const bucketTimestamp = floorTimestamp(tick.timestamp, timeframe);
    const bucket = buckets.get(bucketTimestamp) ?? [];
    bucket.push(tick);
    buckets.set(bucketTimestamp, bucket);
  }

  return Array.from(buckets.entries())
    .sort((left, right) => left[0] - right[0])
    .map(([, bucketTicks]) => buildBarFromTicks(bucketTicks, timeframe, broker, symbol))
    .filter((bar): bar is ChartBar => bar != null);
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
  const [latestAlertEvent, setLatestAlertEvent] = useState<LiveAlertTriggerEvent | null>(null);
  const [status, setStatus] = useState<LiveChartStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [backfillCompletedAt, setBackfillCompletedAt] = useState<number | null>(null);
  const [sessionIdState, setSessionIdState] = useState<string | null>(null);

  const previousBarRef = useRef<ChartBar | null>(null);
  const previousQuoteRef = useRef<LiveQuote | null>(null);
  const lastLiveEventAtRef = useRef(0);
  const apiRef = useRef(new CTraderAPI());
  const chartRepoRef = useRef(new DexieChartBarRepository());
  const progressRepoRef = useRef(new DexieSymbolSyncProgressRepository());
  const lastPersistedClosedBarTimestampRef = useRef<number | null>(null);
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
      previousQuoteRef.current = null;
      setCurrentBar(null);
      setQuote(null);
      setPositions([]);
      setOrders([]);
      setLatestAlertEvent(null);
      setStatus("idle");
      setError(null);
      setSessionIdState(null);
      lastPersistedClosedBarTimestampRef.current = null;
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
    let reconcilePromise: Promise<void> = Promise.resolve();

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
      const sanitizedBar = sanitizeLiveBar(bar, normalizedSymbol, bar?.close);
      if (!sanitizedBar) return;
      try {
        await chartRepo.upsertMany([sanitizedBar]);
        lastPersistedClosedBarTimestampRef.current = sanitizedBar.timestamp;
        await refreshLocalProgressMetadata();
      } catch (persistError) {
        console.warn("[useCTraderLiveBar] Failed to persist completed live bar:", persistError);
      }
    };

    const mapAuthoritativeBars = (bars: Awaited<ReturnType<typeof api.getBars>>) =>
      bars
        .map((bar) => ({
          ...CTraderMapper.toChartBar(bar),
          broker,
        }))
        .filter((bar) => sanitizeLiveBar(bar, normalizedSymbol, bar.close) != null)
        .sort((left, right) => left.timestamp - right.timestamp);

    const fetchAndPersistAuthoritativeBars = async (
      targetTimeframe: ChartTimeframe,
      fromTimestamp: number,
      toTimestamp: number
    ) => {
      if (
        !Number.isFinite(fromTimestamp) ||
        !Number.isFinite(toTimestamp) ||
        fromTimestamp > toTimestamp
      ) {
        return [];
      }

      const apiBars = await api.getBars(
        accessToken,
        normalizedSymbol,
        targetTimeframe,
        fromTimestamp,
        toTimestamp,
        accountNumber
      );
      const authoritativeBars = mapAuthoritativeBars(apiBars);
      if (authoritativeBars.length > 0) {
        await chartRepo.upsertMany(authoritativeBars);
      }
      return authoritativeBars;
    };

    const reconcileClosedBars = (
      nextOpenBucketTimestamp: number,
      fallbackBar?: ChartBar | null
    ) => {
      reconcilePromise = reconcilePromise.then(async () => {
        if (cancelled) return;

        const intervalMs = TIMEFRAME_TO_MS[timeframe];
        const latestPersistedClosedTimestamp = lastPersistedClosedBarTimestampRef.current;
        const firstMissingBucketTimestamp =
          latestPersistedClosedTimestamp != null
            ? latestPersistedClosedTimestamp + intervalMs
            : fallbackBar?.timestamp ?? null;

        if (
          firstMissingBucketTimestamp == null ||
          !Number.isFinite(firstMissingBucketTimestamp) ||
          firstMissingBucketTimestamp >= nextOpenBucketTimestamp
        ) {
          return;
        }

        const historyTo = nextOpenBucketTimestamp - 1;
        if (!Number.isFinite(historyTo) || historyTo < firstMissingBucketTimestamp) {
          return;
        }

        try {
          const apiBars = await api.getBars(
            accessToken,
            normalizedSymbol,
            timeframe,
            firstMissingBucketTimestamp,
            historyTo,
            accountNumber
          );
          const authoritativeBars = mapAuthoritativeBars(apiBars);
          if (authoritativeBars.length > 0) {
            await chartRepo.upsertMany(authoritativeBars);
            lastPersistedClosedBarTimestampRef.current =
              authoritativeBars[authoritativeBars.length - 1]?.timestamp ??
              lastPersistedClosedBarTimestampRef.current;
            await refreshLocalProgressMetadata();
            return;
          }
        } catch {
          // Fall through to tick or synthetic fallback.
        }

        try {
          if (sessionId) {
            const ticksResponse = await fetch(
              buildLocalServiceEndpoint(
                `/api/ctrader/live/ticks?sessionId=${encodeURIComponent(
                  sessionId
                )}&from=${firstMissingBucketTimestamp}&to=${historyTo}`,
                effectiveServiceUrl
              )
            );
            const ticksPayload = (await ticksResponse.json()) as {
              bidTicks?: Array<{ timestamp: number; price: number }>;
              askTicks?: Array<{ timestamp: number; price: number }>;
            };

            if (ticksResponse.ok) {
              const referencePrice =
                previousBarRef.current?.close ?? getReferencePriceFromQuote(previousQuoteRef.current);
              const bidTicks = sanitizeTickSeries(
                Array.isArray(ticksPayload.bidTicks) ? ticksPayload.bidTicks : [],
                normalizedSymbol,
                referencePrice
              );
              const askTicks = sanitizeTickSeries(
                Array.isArray(ticksPayload.askTicks) ? ticksPayload.askTicks : [],
                normalizedSymbol,
                bidTicks[bidTicks.length - 1]?.price ?? referencePrice
              );
              const authoritativeBars = buildBarsFromTicksRange(
                bidTicks.length > 0 ? bidTicks : askTicks,
                timeframe,
                broker,
                normalizedSymbol
              ).filter((bar) => bar.timestamp >= firstMissingBucketTimestamp && bar.timestamp < nextOpenBucketTimestamp);

              if (authoritativeBars.length > 0) {
                await chartRepo.upsertMany(authoritativeBars);
                lastPersistedClosedBarTimestampRef.current =
                  authoritativeBars[authoritativeBars.length - 1]?.timestamp ??
                  lastPersistedClosedBarTimestampRef.current;
                await refreshLocalProgressMetadata();
                return;
              }
            }
          }
        } catch {
          // Ignore tick fallback failures and continue to guarded synthetic fallback.
        }

        const sanitizedFallbackBar = sanitizeLiveBar(
          fallbackBar,
          normalizedSymbol,
          fallbackBar?.close
        );
        if (
          sanitizedFallbackBar &&
          sanitizedFallbackBar.timestamp >= firstMissingBucketTimestamp &&
          sanitizedFallbackBar.timestamp < nextOpenBucketTimestamp &&
          (sanitizedFallbackBar.volume > 1 ||
            sanitizedFallbackBar.high !== sanitizedFallbackBar.low)
        ) {
          await persistCompletedBar(sanitizedFallbackBar);
        }
      }).catch(() => {});
    };

    const applyPayload = (payload: unknown) => {
      if (cancelled || !payload || typeof payload !== "object") return;

      const next = payload as {
        type?: string;
        event?: LiveAlertTriggerEvent | null;
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
        if (next.event?.id) {
          setLatestAlertEvent(next.event);
        }
        return;
      }

      const previousQuote = previousQuoteRef.current;
      const previousBarCandidate = sanitizeLiveBar(
        previousBarRef.current,
        normalizedSymbol,
        getReferencePriceFromQuote(previousQuote)
      );
      if (!previousBarCandidate) {
        previousBarRef.current = null;
      }

      const referencePrice =
        previousBarCandidate?.close ?? getReferencePriceFromQuote(previousQuote);
      const sanitizedBid = sanitizeLivePrice(
        typeof next.bid === "number" ? next.bid : undefined,
        normalizedSymbol,
        referencePrice
      );
      const sanitizedAsk = sanitizeLivePrice(
        typeof next.ask === "number" ? next.ask : undefined,
        normalizedSymbol,
        sanitizedBid ?? referencePrice
      );
      const livePrice =
        sanitizedBid ?? sanitizedAsk;
      const spotTimestamp =
        typeof next.spotTimestamp === "number" ? next.spotTimestamp : Date.now();

      const seededBar = sanitizeLiveBar(
        next.currentBar
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
          : null,
        normalizedSymbol,
        livePrice ?? referencePrice
      );
      if (livePrice == null && !seededBar) {
        return;
      }

      const nextQuote =
        livePrice != null || previousQuote != null
          ? {
              bid: sanitizedBid ?? previousQuote?.bid,
              ask: sanitizedAsk ?? previousQuote?.ask,
              spotTimestamp,
            }
          : null;
      if (nextQuote) {
        previousQuoteRef.current = nextQuote;
        setQuote(nextQuote);
      }
      lastLiveEventAtRef.current = Date.now();

      const previousBar = previousBarCandidate;
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
        reconcileClosedBars(liveBar.timestamp, previousBar);
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

        const nowTimestamp = Date.now();
        const intervalMs = TIMEFRAME_TO_MS[timeframe];
        const currentBucketStart = floorTimestamp(nowTimestamp, timeframe);
        const currentM1BucketStart = floorTimestamp(nowTimestamp, "M1");
        const [range, m1Range] = await Promise.all([
          chartRepo.getDateRange(broker, normalizedSymbol, timeframe),
          timeframe === "M1"
            ? Promise.resolve(null)
            : chartRepo.getDateRange(broker, normalizedSymbol, "M1"),
        ]);
        const latestLocalTimestamp = range.lastBarDate?.getTime() ?? null;
        lastPersistedClosedBarTimestampRef.current =
          latestLocalTimestamp != null && latestLocalTimestamp < currentBucketStart
            ? latestLocalTimestamp
            : null;

        if (timeframe !== "M1") {
          const earliestLocalTimestamp = range.firstBarDate?.getTime() ?? null;
          const repairStart =
            latestLocalTimestamp != null
              ? Math.max(
                  earliestLocalTimestamp ?? latestLocalTimestamp,
                  latestLocalTimestamp - intervalMs * LIVE_SERVER_REPAIR_BARS
                )
              : Math.max(0, currentBucketStart - intervalMs * LIVE_SERVER_REPAIR_BARS);

          await fetchAndPersistAuthoritativeBars(timeframe, repairStart, currentBucketStart);

          const refreshedTimeframeRange = await chartRepo.getDateRange(
            broker,
            normalizedSymbol,
            timeframe
          );
          const refreshedLastTimestamp = refreshedTimeframeRange.lastBarDate?.getTime() ?? null;
          lastPersistedClosedBarTimestampRef.current =
            refreshedLastTimestamp != null && refreshedLastTimestamp < currentBucketStart
              ? refreshedLastTimestamp
              : null;
        }

        const earliestM1Timestamp =
          timeframe === "M1"
            ? range.firstBarDate?.getTime() ?? null
            : m1Range?.firstBarDate?.getTime() ?? null;
        const latestM1Timestamp =
          timeframe === "M1"
            ? latestLocalTimestamp
            : m1Range?.lastBarDate?.getTime() ?? null;
        const m1BackfillFrom =
          latestM1Timestamp != null
            ? Math.max(
                earliestM1Timestamp ?? latestM1Timestamp,
                latestM1Timestamp - LIVE_M1_REPAIR_LOOKBACK_MS
              )
            : Math.max(0, currentM1BucketStart - LIVE_M1_REPAIR_LOOKBACK_MS);
        if (
          Number.isFinite(m1BackfillFrom) &&
          m1BackfillFrom <= currentM1BucketStart
        ) {
          const syncUseCase = new HybridSyncChartBarsUseCase(
            api,
            chartRepo,
            progressRepo
          );
          const backfillResult = await syncUseCase.execute({
            userId: "live-backfill",
            broker,
            symbol: normalizedSymbol,
            fromDate: new Date(m1BackfillFrom),
            toDate: new Date(currentM1BucketStart),
            accessToken,
            accountNumber,
            forceFullSync: true,
          });
          if (!backfillResult.success) {
            throw new Error(backfillResult.error ?? "Failed to backfill live chart bars.");
          }
        }

        if (timeframe === "M1") {
          const refreshedRange = await chartRepo.getDateRange(
            broker,
            normalizedSymbol,
            "M1"
          );
          const refreshedLastTimestamp = refreshedRange.lastBarDate?.getTime() ?? null;
          lastPersistedClosedBarTimestampRef.current =
            refreshedLastTimestamp != null && refreshedLastTimestamp < currentBucketStart
              ? refreshedLastTimestamp
              : lastPersistedClosedBarTimestampRef.current;
        }

        if (!cancelled) {
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

        reconcileClosedBars(floorTimestamp(Date.now(), timeframe));

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
            `Could not reach the local cTrader live service at ${effectiveServiceUrl}. Start it with \`npm run mt5:service\`.`
          );
        };

        fallbackTimer = window.setInterval(async () => {
          if (cancelled) return;

          reconcileClosedBars(floorTimestamp(Date.now(), timeframe));

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

            const referencePrice =
              previousBarRef.current?.close ??
              getReferencePriceFromQuote(previousQuoteRef.current);
            const bidTicks = sanitizeTickSeries(
              Array.isArray(ticksPayload.bidTicks) ? ticksPayload.bidTicks : [],
              normalizedSymbol,
              referencePrice
            );
            const askTicks = sanitizeTickSeries(
              Array.isArray(ticksPayload.askTicks) ? ticksPayload.askTicks : [],
              normalizedSymbol,
              bidTicks[bidTicks.length - 1]?.price ?? referencePrice
            );

            const liveBar = buildBarFromTicks(
              bidTicks.length > 0 ? bidTicks : askTicks,
              timeframe,
              broker,
              normalizedSymbol
            );
            if (!liveBar) return;

            const previousBar = previousBarRef.current;
            if (previousBar && liveBar.timestamp > previousBar.timestamp) {
              reconcileClosedBars(liveBar.timestamp, previousBar);
            }

            previousBarRef.current = liveBar;
            setCurrentBar(liveBar);
            const nextQuote = {
              bid: bidTicks[bidTicks.length - 1]?.price ?? previousQuoteRef.current?.bid,
              ask: askTicks[askTicks.length - 1]?.price ?? previousQuoteRef.current?.ask,
              spotTimestamp:
                bidTicks[bidTicks.length - 1]?.timestamp ??
                askTicks[askTicks.length - 1]?.timestamp ??
                Date.now(),
            };
            previousQuoteRef.current = nextQuote;
            setQuote(nextQuote);
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
    latestAlertEvent,
    status,
    error,
    backfillCompletedAt,
    sessionId: sessionIdState,
    serviceUrl,
  };
}
