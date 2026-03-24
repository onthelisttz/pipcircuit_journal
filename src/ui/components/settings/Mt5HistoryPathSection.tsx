"use client";

import { format, formatDistanceToNowStrict } from "date-fns";
import { CheckCircle2, ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createSettingsRepository } from "@infrastructure/db/createDualRepositories";
import {
  buildMt5ServiceEndpoint,
  DEFAULT_MT5_LOCAL_SERVICE_URL,
  MT5_HISTORY_ROOT_SETTING_KEY,
  MT5_LOCAL_SERVICE_URL_SETTING_KEY,
  normalizeMt5ServiceUrl,
} from "@lib/mt5";
import { useAuth } from "@ui/hooks/useAuth";

const REQUEST_TIMEFRAME = "M1";
const REQUEST_FALLBACK_DAYS = 30;
const REQUEST_TIMEFRAME_MS = 60_000;
const CARD_DATE_TIME_FORMAT = "MMMM d, yyyy HH:mm";

type RequestBarsResponse = {
  ok?: boolean;
  error?: string;
  count?: number;
  firstTimestamp?: number | null;
  lastTimestamp?: number | null;
  bridgeMode?: "bundled" | "python";
};

type TimeframeSummary = {
  timeframe: string;
  fileName: string;
  barCount: number;
  from: number;
  to: number;
  updatedAt?: number;
  source?: "cache" | "derived" | "live";
};

type SymbolSummary = {
  symbol: string;
  timeframes: TimeframeSummary[];
};

type MetaResponse = {
  sourcePath: string;
  symbols: SymbolSummary[];
  error?: string;
};

type SymbolCard = {
  symbol: string;
  summary: TimeframeSummary | null;
};

export function Mt5HistoryPathSection() {
  const { user } = useAuth();
  const settingsRepo = useMemo(() => createSettingsRepository(user?.id), [user?.id]);
  const [historyRootValue, setHistoryRootValue] = useState("");
  const [savedHistoryRootValue, setSavedHistoryRootValue] = useState("");
  const [savedServiceUrlValue, setSavedServiceUrlValue] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [symbolCards, setSymbolCards] = useState<SymbolCard[]>([]);
  const [isRequestingSymbol, setIsRequestingSymbol] = useState<string | null>(null);
  const [requestStatusBySymbol, setRequestStatusBySymbol] = useState<Record<string, string>>({});
  const [isSummaryLoading, setIsSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [isSymbolsExpanded, setIsSymbolsExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setIsLoading(true);
      setStatus(null);
      try {
        const [rootRecord, serviceRecord] = await Promise.all([
          settingsRepo.get(MT5_HISTORY_ROOT_SETTING_KEY),
          settingsRepo.get(MT5_LOCAL_SERVICE_URL_SETTING_KEY),
        ]);
        if (cancelled) return;
        const nextRootValue =
          typeof rootRecord?.value === "string" ? rootRecord.value : "";
        const nextServiceUrl =
          typeof serviceRecord?.value === "string" ? serviceRecord.value : "";
        setHistoryRootValue(nextRootValue);
        setSavedHistoryRootValue(nextRootValue);
        setSavedServiceUrlValue(nextServiceUrl);
      } catch (error) {
        if (!cancelled) {
          setStatus(
            error instanceof Error ? error.message : "Failed to load MT5 settings."
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [settingsRepo]);

  const handleSave = useCallback(async () => {
    const trimmedRoot = historyRootValue.trim();
    setIsSaving(true);
    setStatus(null);
    try {
      if (trimmedRoot) {
        await settingsRepo.set({
          key: MT5_HISTORY_ROOT_SETTING_KEY,
          value: trimmedRoot,
        });
      } else {
        await settingsRepo.remove(MT5_HISTORY_ROOT_SETTING_KEY);
      }

      setSavedHistoryRootValue(trimmedRoot);
      setHistoryRootValue(trimmedRoot);
      setStatus("MT5 settings saved.");
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Failed to save MT5 settings."
      );
    } finally {
      setIsSaving(false);
    }
  }, [historyRootValue, settingsRepo]);

  const isDirty = historyRootValue.trim() !== savedHistoryRootValue.trim();

  const effectiveServiceUrl = useMemo(() => {
    const normalized = normalizeMt5ServiceUrl(savedServiceUrlValue);
    return normalized || DEFAULT_MT5_LOCAL_SERVICE_URL;
  }, [savedServiceUrlValue]);

  const loadSymbolSummaries = useCallback(async () => {
    setIsSummaryLoading(true);
    setSummaryError(null);
    try {
      const endpoint = buildMt5ServiceEndpoint("/api/mt5/history/meta", effectiveServiceUrl);
      const params = new URLSearchParams();
      const resolvedHistoryRoot = historyRootValue.trim() || savedHistoryRootValue.trim();
      if (resolvedHistoryRoot) {
        params.set("rootPath", resolvedHistoryRoot);
      }
      const response = await fetch(
        `${endpoint}${params.toString() ? `?${params.toString()}` : ""}`,
        {
          cache: "no-store",
        }
      );
      const payload = (await response.json()) as MetaResponse;
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to inspect MT5 history.");
      }

      const nextCards = payload.symbols
        .map((item) => ({
          symbol: item.symbol,
          summary:
            item.timeframes.find((timeframe) => timeframe.timeframe === REQUEST_TIMEFRAME) ??
            null,
        }))
        .sort((a, b) => a.symbol.localeCompare(b.symbol));
      setSymbolCards(nextCards);
    } catch (error) {
      setSymbolCards([]);
      setSummaryError(
        error instanceof TypeError
          ? `Could not reach the local MT5 service at ${effectiveServiceUrl}. Start it with \`npm run mt5:service\`.`
          : error instanceof Error
            ? error.message
            : "Failed to inspect MT5 history."
      );
    } finally {
      setIsSummaryLoading(false);
    }
  }, [
    effectiveServiceUrl,
    historyRootValue,
    savedHistoryRootValue,
  ]);

  useEffect(() => {
    void loadSymbolSummaries();
  }, [loadSymbolSummaries]);

  const handleRequestBars = useCallback(async (symbol: string, summary: TimeframeSummary | null) => {
    const normalizedSymbol = symbol.trim().toUpperCase();
    setIsRequestingSymbol(normalizedSymbol);
    setRequestStatusBySymbol((current) => ({
      ...current,
      [normalizedSymbol]: "",
    }));
    try {
      const endpoint = buildMt5ServiceEndpoint(
        "/api/mt5/history/request-bars",
        effectiveServiceUrl
      );
      const now = Date.now();
      const from =
        (summary?.to ?? now - REQUEST_FALLBACK_DAYS * 24 * 60 * 60 * 1000) +
        (summary ? REQUEST_TIMEFRAME_MS : 0);
      const to = Math.max(now, from + REQUEST_TIMEFRAME_MS);
      const resolvedHistoryRoot = historyRootValue.trim() || savedHistoryRootValue.trim();
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          symbol: normalizedSymbol,
          timeframe: REQUEST_TIMEFRAME,
          from,
          to,
          historyRoot: resolvedHistoryRoot,
        }),
      });

      const payload = (await response.json()) as RequestBarsResponse;
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to request MT5 bars.");
      }

      const count = payload.count ?? 0;
      const bridgeNote =
        payload.bridgeMode === "bundled"
          ? "using the bundled MT5 bridge"
          : payload.bridgeMode === "python"
            ? "using the Python MT5 bridge"
            : "through the MT5 bridge";
      setRequestStatusBySymbol((current) => ({
        ...current,
        [normalizedSymbol]:
          count > 0
            ? `Requested ${count.toLocaleString()} ${REQUEST_TIMEFRAME} bars for ${normalizedSymbol} ${bridgeNote}.`
            : `Request sent for ${normalizedSymbol}, but MT5 returned no bars for that range.`,
      }));
      await loadSymbolSummaries();
    } catch (error) {
      setRequestStatusBySymbol((current) => ({
        ...current,
        [normalizedSymbol]:
          error instanceof TypeError
            ? `Could not reach the local MT5 service at ${effectiveServiceUrl}. Start it with \`npm run mt5:service\`.`
            : error instanceof Error
              ? error.message
              : "Failed to request MT5 bars.",
      }));
    } finally {
      setIsRequestingSymbol((current) => (current === normalizedSymbol ? null : current));
    }
  }, [
    effectiveServiceUrl,
    historyRootValue,
    loadSymbolSummaries,
    savedHistoryRootValue,
  ]);

  const symbolsWithBars = symbolCards.filter((card) => card.summary).length;
  const totalBars = symbolCards.reduce(
    (sum, card) => sum + (card.summary?.barCount ?? 0),
    0
  );

  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-4">
      <div>
        <h2 className="text-base font-semibold text-foreground">MT5 History</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Run the local MT5 service on this computer, then keep the MT5 history folder path up to date.
        </p>
      </div>

      <div className="space-y-2.5">
        <label
          htmlFor="mt5-history-root"
          className="text-sm font-medium text-foreground"
        >
          History folder path
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id="mt5-history-root"
            type="text"
            value={historyRootValue}
            onChange={(event) => setHistoryRootValue(event.target.value)}
            placeholder="Example: C:\\Users\\costa\\AppData\\Roaming\\MetaQuotes\\Terminal\\...\\bases\\Pepperstone-Demo\\history"
            disabled={isLoading || isSaving}
            className="h-10 flex-1 rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary disabled:opacity-60"
          />
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={isLoading || isSaving || !isDirty}
            className="inline-flex h-10 items-center justify-center rounded-lg border border-border bg-background px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60 sm:min-w-[110px]"
          >
            {isSaving ? "Saving..." : "Save"}
          </button>
        </div>
        {status && <p className="text-xs text-muted-foreground">{status}</p>}
      </div>

      <div className="rounded-lg border border-border bg-muted/40">
        <div
          onClick={() => setIsSymbolsExpanded((current) => !current)}
          className="flex w-full cursor-pointer flex-col gap-3 p-4 transition-colors hover:bg-accent/40 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex items-center gap-3">
            {isSymbolsExpanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
            <div>
              <h3 className="font-semibold text-foreground">Available MT5 Symbols</h3>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span>{symbolCards.length} symbols</span>
                {symbolsWithBars > 0 && (
                  <span className="text-emerald-500">{symbolsWithBars} with history</span>
                )}
                {totalBars > 0 && <span>{totalBars.toLocaleString()} bars</span>}
                <span>MT5 starts in the background automatically.</span>
              </div>
            </div>
          </div>

          <div
            className="flex items-center gap-2 sm:self-auto sm:justify-end"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => void loadSymbolSummaries()}
              disabled={isSummaryLoading || isRequestingSymbol !== null}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted disabled:opacity-60"
              title="Refresh local MT5 summaries"
            >
              <RefreshCw className={`h-4 w-4 ${isSummaryLoading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

        {isSymbolsExpanded && (
          <div className="space-y-2.5 border-t border-border/60 p-3">
            {symbolCards.map(({ symbol, summary }) => {
          const cardStatus =
            isRequestingSymbol === symbol
              ? "syncing"
              : summary
                ? "completed"
                : isSummaryLoading
                  ? "checking"
                  : "not found";

          const summaryDateRange = summary
            ? `${format(new Date(summary.from), CARD_DATE_TIME_FORMAT)} to ${format(
                new Date(summary.to),
                CARD_DATE_TIME_FORMAT
              )}`
            : "No local M1 bars yet";

          const lastSyncLabel = summary
            ? `${format(
                new Date(summary.updatedAt ?? summary.to),
                CARD_DATE_TIME_FORMAT
              )} (${formatDistanceToNowStrict(new Date(summary.updatedAt ?? summary.to))} ago)`
            : "Never";

          return (
            <div key={symbol} className="rounded-xl border border-border/70 bg-card/70 p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className={`h-5 w-5 ${cardStatus === "not found" ? "text-muted-foreground" : "text-emerald-400"}`} />
                    <span className="truncate text-xl font-semibold text-foreground">
                      {symbol}
                    </span>
                    <span className={`text-sm ${cardStatus === "not found" ? "text-muted-foreground" : "text-emerald-400"}`}>
                      {cardStatus}
                    </span>
                  </div>
                  <p className="mt-3 text-sm font-medium text-emerald-400">
                    Total bars: {(summary?.barCount ?? 0).toLocaleString()}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Local: {(summary?.barCount ?? 0).toLocaleString()} bars
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Date range: {summaryDateRange}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Last sync: {lastSyncLabel}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleRequestBars(symbol, summary)}
                    disabled={isRequestingSymbol !== null}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-background text-foreground transition-colors hover:bg-muted disabled:opacity-60"
                    title={
                      isRequestingSymbol === symbol
                        ? `Requesting latest ${REQUEST_TIMEFRAME} bars for ${symbol}`
                        : `Request latest ${REQUEST_TIMEFRAME} bars for ${symbol}`
                    }
                  >
                    <RefreshCw
                      className={`h-4 w-4 ${isRequestingSymbol === symbol ? "animate-spin" : ""}`}
                    />
                  </button>
                </div>
              </div>
              {requestStatusBySymbol[symbol] && (
                <p className="mt-3 text-xs text-muted-foreground">
                  {requestStatusBySymbol[symbol]}
                </p>
              )}
              {!summary && (
                <p className="mt-3 text-xs text-muted-foreground">
                  No local {REQUEST_TIMEFRAME} history found yet, so the first request falls back to the last {REQUEST_FALLBACK_DAYS} days.
                </p>
              )}
            </div>
            );
          })}

            {symbolCards.length === 0 && !isSummaryLoading && !summaryError && (
              <p className="text-xs text-muted-foreground">
                No symbols were found in the MT5 history folder.
              </p>
            )}
            {summaryError && <p className="text-xs text-muted-foreground">{summaryError}</p>}
            {!summaryError && !isSummaryLoading && symbolCards.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Fresh requests always use {REQUEST_TIMEFRAME} and continue from the last local bar forward.
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
