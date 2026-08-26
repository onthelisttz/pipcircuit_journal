"use client";

import { useMemo, useState, useCallback } from "react";
import type { Trade } from "@domain/entities";
import { Direction } from "@domain/enums";
import { format } from "date-fns";
import { ChevronUp, ChevronDown, ChevronsUpDown, ChevronLeft, ChevronRight } from "lucide-react";
import { volumeToLots } from "@lib/pnl-estimate";

const PAGE_SIZE = 20;

type SortKey =
  | "symbol"
  | "direction"
  | "openTime"
  | "closeTime"
  | "lots"
  | "entryPrice"
  | "closePrice"
  | "netProfit"
  | "balance"
  | "gain"
  | "pips"
  | "duration"
  | "commission";

type SortDir = "asc" | "desc";

type SummaryFilter = "long" | "short" | "all";

interface DashboardTradeTableProps {
  trades: Trade[];
  /** Starting balance for running balance (optional, defaults to 0) */
  startingBalance?: number;
  onRowClick?: (trade: Trade, allIds: number[]) => void;
  /** Called when Long, Short, or Total summary row is clicked */
  onSummaryClick?: (filter: SummaryFilter, tradeIds: number[]) => void;
}

function formatProfit(n: number | undefined): string {
  if (n === undefined || n === null) return "-";
  const sign = n >= 0 ? "+" : "";
  return `${sign}$${n.toFixed(2)}`;
}

function formatPrice(n: number | undefined | null): string {
  if (n === undefined || n === null || !Number.isFinite(n)) return "-";
  return n.toFixed(5);
}

function getDuration(open: Date | string, close: Date | string | null | undefined): string {
  if (!close) return "-";
  const o = open instanceof Date ? open : new Date(open);
  const c = close instanceof Date ? close : new Date(close);
  const ms = c.getTime() - o.getTime();
  if (ms < 0) return "-";
  const mins = Math.floor(ms / 60_000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${mins % 60}m`;
  return `${mins}m`;
}

function SortIcon({ sortKey, currentKey, dir }: { sortKey: SortKey; currentKey: SortKey; dir: SortDir }) {
  if (sortKey !== currentKey) return <ChevronsUpDown className="w-3.5 h-3.5 text-muted-foreground" />;
  return dir === "asc" ? (
    <ChevronUp className="w-3.5 h-3.5 text-primary" />
  ) : (
    <ChevronDown className="w-3.5 h-3.5 text-primary" />
  );
}

export function DashboardTradeTable({ trades, startingBalance = 0, onRowClick, onSummaryClick }: DashboardTradeTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>("closeTime");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(1);

  const handleSort = useCallback((key: SortKey) => {
    setPage(1);
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDir("desc");
  }, [sortKey]);

  const balanceByTradeId = useMemo(() => {
    const byCloseTime = [...trades].sort((a, b) => {
      const ta = a.closeTime ? (a.closeTime instanceof Date ? a.closeTime.getTime() : new Date(a.closeTime).getTime()) : 0;
      const tb = b.closeTime ? (b.closeTime instanceof Date ? b.closeTime.getTime() : new Date(b.closeTime).getTime()) : 0;
      return ta - tb;
    });
    const map = new Map<number, number>();
    let running = startingBalance;
    for (const t of byCloseTime) {
      if (t.id != null) {
        const pnl = t.netProfit ?? t.grossProfit ?? 0;
        running += pnl;
        map.set(t.id, running);
      }
    }
    return map;
  }, [trades, startingBalance]);

  const sortedTrades = useMemo(() => {
    const arr = [...trades];
    const mult = sortDir === "asc" ? 1 : -1;

    arr.sort((a, b) => {
      let va: string | number | Date;
      let vb: string | number | Date;

      switch (sortKey) {
        case "symbol":
          va = a.symbol ?? "";
          vb = b.symbol ?? "";
          return mult * String(va).localeCompare(String(vb));
        case "direction":
          va = a.direction ?? "";
          vb = b.direction ?? "";
          return mult * String(va).localeCompare(String(vb));
        case "openTime":
          va = a.openTime instanceof Date ? a.openTime.getTime() : new Date(a.openTime).getTime();
          vb = b.openTime instanceof Date ? b.openTime.getTime() : new Date(b.openTime).getTime();
          return mult * (va - vb);
        case "closeTime":
          va = a.closeTime ? (a.closeTime instanceof Date ? a.closeTime.getTime() : new Date(a.closeTime).getTime()) : 0;
          vb = b.closeTime ? (b.closeTime instanceof Date ? b.closeTime.getTime() : new Date(b.closeTime).getTime()) : 0;
          return mult * (va - vb);
        case "lots":
          va =
            a.lots != null && Number.isFinite(a.lots)
              ? a.lots
              : volumeToLots(a.volume ?? 0, a.symbol ?? "");
          vb =
            b.lots != null && Number.isFinite(b.lots)
              ? b.lots
              : volumeToLots(b.volume ?? 0, b.symbol ?? "");
          return mult * (va - vb);
        case "entryPrice":
          va = a.entryPrice ?? a.openPrice ?? 0;
          vb = b.entryPrice ?? b.openPrice ?? 0;
          return mult * (va - vb);
        case "closePrice":
          va = a.closePrice ?? 0;
          vb = b.closePrice ?? 0;
          return mult * (va - vb);
        case "netProfit":
          va = a.netProfit ?? a.grossProfit ?? 0;
          vb = b.netProfit ?? b.grossProfit ?? 0;
          return mult * (va - vb);
        case "balance":
          va = a.balance ?? (a.id != null ? balanceByTradeId.get(a.id) ?? 0 : 0);
          vb = b.balance ?? (b.id != null ? balanceByTradeId.get(b.id) ?? 0 : 0);
          return mult * (va - vb);
        case "gain":
          va = a.percentGain ?? 0;
          vb = b.percentGain ?? 0;
          return mult * (va - vb);
        case "pips":
          va = a.pips ?? 0;
          vb = b.pips ?? 0;
          return mult * (va - vb);
        case "duration":
          const da = a.closeTime
            ? (a.closeTime instanceof Date ? a.closeTime.getTime() : new Date(a.closeTime).getTime()) -
              (a.openTime instanceof Date ? a.openTime.getTime() : new Date(a.openTime).getTime())
            : 0;
          const db = b.closeTime
            ? (b.closeTime instanceof Date ? b.closeTime.getTime() : new Date(b.closeTime).getTime()) -
              (b.openTime instanceof Date ? b.openTime.getTime() : new Date(b.openTime).getTime())
            : 0;
          return mult * (da - db);
        case "commission":
          va = a.commission ?? 0;
          vb = b.commission ?? 0;
          return mult * (va - vb);
        default:
          return 0;
      }
    });

    return arr;
  }, [trades, sortKey, sortDir, balanceByTradeId]);

  const { totalPnl, longCount, longPnl, longIds, shortCount, shortPnl, shortIds, totalCommission, longCommission, shortCommission } = useMemo(() => {
    let total = 0;
    const long: number[] = [];
    let longSum = 0;
    let longComm = 0;
    const short: number[] = [];
    let shortSum = 0;
    let shortComm = 0;
    let totalComm = 0;
    for (const t of trades) {
      const pnl = t.netProfit ?? t.grossProfit ?? 0;
      const comm = t.commission ?? 0;
      total += pnl;
      totalComm += comm;
      if (t.id != null) {
        if (t.direction === Direction.Buy) {
          long.push(t.id);
          longSum += pnl;
          longComm += comm;
        } else {
          short.push(t.id);
          shortSum += pnl;
          shortComm += comm;
        }
      }
    }
    return {
      totalPnl: total,
      longCount: long.length,
      longPnl: longSum,
      longIds: long,
      shortCount: short.length,
      shortPnl: shortSum,
      shortIds: short,
      totalCommission: totalComm,
      longCommission: longComm,
      shortCommission: shortComm,
    };
  }, [trades]);

  const totalPages = Math.max(1, Math.ceil(sortedTrades.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paginatedTrades = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return sortedTrades.slice(start, start + PAGE_SIZE);
  }, [sortedTrades, currentPage]);

  const allIds = useMemo(
    () => trades.map((t) => t.id).filter((id): id is number => id != null),
    [trades]
  );

  if (trades.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 text-center">
        <p className="text-sm text-muted-foreground">No trades in this period.</p>
      </div>
    );
  }

  return (
    <div className="w-full overflow-x-auto rounded-xl border border-border bg-card">
      <table className="w-full min-w-[980px] text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40">
            <th className="px-4 py-3 text-left font-medium">
              <button
                type="button"
                onClick={() => handleSort("symbol")}
                className="flex items-center gap-1.5 hover:text-foreground"
              >
                Symbol <SortIcon sortKey="symbol" currentKey={sortKey} dir={sortDir} />
              </button>
            </th>
            <th className="px-4 py-3 text-left font-medium">
              <button
                type="button"
                onClick={() => handleSort("direction")}
                className="flex items-center gap-1.5 hover:text-foreground"
              >
                Dir <SortIcon sortKey="direction" currentKey={sortKey} dir={sortDir} />
              </button>
            </th>
            <th className="px-4 py-3 text-left font-medium">
              <button
                type="button"
                onClick={() => handleSort("openTime")}
                className="flex items-center gap-1.5 hover:text-foreground"
              >
                Open <SortIcon sortKey="openTime" currentKey={sortKey} dir={sortDir} />
              </button>
            </th>
            <th className="px-4 py-3 text-left font-medium">
              <button
                type="button"
                onClick={() => handleSort("closeTime")}
                className="flex items-center gap-1.5 hover:text-foreground"
              >
                Close <SortIcon sortKey="closeTime" currentKey={sortKey} dir={sortDir} />
              </button>
            </th>
            <th className="px-4 py-3 text-right font-medium">
              <button
                type="button"
                onClick={() => handleSort("lots")}
                className="ml-auto flex items-center gap-1.5 hover:text-foreground"
              >
                Lots <SortIcon sortKey="lots" currentKey={sortKey} dir={sortDir} />
              </button>
            </th>
            <th className="px-4 py-3 text-right font-medium">
              <button
                type="button"
                onClick={() => handleSort("entryPrice")}
                className="ml-auto flex items-center gap-1.5 hover:text-foreground"
              >
                Entry <SortIcon sortKey="entryPrice" currentKey={sortKey} dir={sortDir} />
              </button>
            </th>
            <th className="px-4 py-3 text-right font-medium">
              <button
                type="button"
                onClick={() => handleSort("closePrice")}
                className="ml-auto flex items-center gap-1.5 hover:text-foreground"
              >
                Exit <SortIcon sortKey="closePrice" currentKey={sortKey} dir={sortDir} />
              </button>
            </th>
            <th className="px-4 py-3 text-right font-medium">
              <button
                type="button"
                onClick={() => handleSort("netProfit")}
                className="ml-auto flex items-center gap-1.5 hover:text-foreground"
              >
                P&L <SortIcon sortKey="netProfit" currentKey={sortKey} dir={sortDir} />
              </button>
            </th>
            <th className="px-4 py-3 text-right font-medium">
              <button
                type="button"
                onClick={() => handleSort("balance")}
                className="ml-auto flex items-center gap-1.5 hover:text-foreground"
              >
                Balance <SortIcon sortKey="balance" currentKey={sortKey} dir={sortDir} />
              </button>
            </th>
            <th className="px-4 py-3 text-right font-medium">
              <button
                type="button"
                onClick={() => handleSort("gain")}
                className="ml-auto flex items-center gap-1.5 hover:text-foreground"
              >
                Gain % <SortIcon sortKey="gain" currentKey={sortKey} dir={sortDir} />
              </button>
            </th>
            <th className="px-4 py-3 text-right font-medium">
              <button
                type="button"
                onClick={() => handleSort("pips")}
                className="ml-auto flex items-center gap-1.5 hover:text-foreground"
              >
                Pips <SortIcon sortKey="pips" currentKey={sortKey} dir={sortDir} />
              </button>
            </th>
            <th className="px-4 py-3 text-left font-medium">
              <button
                type="button"
                onClick={() => handleSort("duration")}
                className="flex items-center gap-1.5 hover:text-foreground"
              >
                Duration <SortIcon sortKey="duration" currentKey={sortKey} dir={sortDir} />
              </button>
            </th>
            <th className="px-4 py-3 text-right font-medium">
              <button
                type="button"
                onClick={() => handleSort("commission")}
                className="ml-auto flex items-center gap-1.5 hover:text-foreground"
              >
                Comm <SortIcon sortKey="commission" currentKey={sortKey} dir={sortDir} />
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          {paginatedTrades.map((trade) => {
            const profit = trade.netProfit ?? trade.grossProfit ?? 0;
            const isPositive = profit >= 0;
            const lots =
              trade.lots != null && Number.isFinite(trade.lots)
                ? trade.lots
                : volumeToLots(trade.volume ?? 0, trade.symbol ?? "");

            return (
              <tr
                key={trade.id ?? trade.ticketId ?? trade.openTime?.toString()}
                onClick={() => trade.id && onRowClick?.(trade, allIds)}
                className={`border-b border-border/60 last:border-0 transition-colors ${
                  onRowClick ? "cursor-pointer hover:bg-accent/50" : ""
                }`}
              >
                <td className="px-4 py-2.5 font-medium text-foreground">{trade.symbol}</td>
                <td className="px-4 py-2.5 text-muted-foreground">{trade.direction}</td>
                <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">
                  {format(new Date(trade.openTime), "MMM d, HH:mm")}
                </td>
                <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">
                  {trade.closeTime ? format(new Date(trade.closeTime), "MMM d, HH:mm") : "-"}
                </td>
                <td className="px-4 py-2.5 text-right text-muted-foreground">{lots.toFixed(2)}</td>
                <td className="px-4 py-2.5 text-right text-muted-foreground font-mono text-xs">
                  {formatPrice(trade.entryPrice ?? trade.openPrice)}
                </td>
                <td className="px-4 py-2.5 text-right text-muted-foreground font-mono text-xs">
                  {formatPrice(trade.closePrice)}
                </td>
                <td
                  className={`px-4 py-2.5 text-right font-medium ${
                    isPositive ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"
                  }`}
                >
                  {formatProfit(profit)}
                </td>
                <td className="px-4 py-2.5 text-right font-medium text-muted-foreground">
                  {trade.balance != null
                    ? formatProfit(trade.balance)
                    : trade.id != null
                      ? formatProfit(balanceByTradeId.get(trade.id))
                      : "-"}
                </td>
                <td
                  className={`px-4 py-2.5 text-right tabular-nums ${
                    (trade.percentGain ?? 0) >= 0
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-destructive"
                  }`}
                >
                  {trade.percentGain != null ? `${trade.percentGain.toFixed(1)}%` : "—"}
                </td>
                <td
                  className={`px-4 py-2.5 text-right tabular-nums ${
                    (trade.pips ?? 0) >= 0
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-destructive"
                  }`}
                >
                  {trade.pips != null ? trade.pips.toFixed(1) : "—"}
                </td>
                <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">
                  {getDuration(trade.openTime, trade.closeTime)}
                </td>
                <td className="px-4 py-2.5 text-right text-muted-foreground">
                  {trade.commission != null ? formatProfit(-trade.commission) : "-"}
                </td>
              </tr>
            );
          })}
          <tr
            onClick={() => onSummaryClick?.("long", longIds)}
            className={`border-t border-border bg-muted/20 ${onSummaryClick ? "cursor-pointer hover:bg-accent/50 transition-colors" : ""}`}
          >
            <td colSpan={2} className="px-4 py-2 text-right text-muted-foreground font-medium">
              Long
            </td>
            <td colSpan={6} className="px-4 py-2 text-right text-muted-foreground">
              {longCount} trades
            </td>
            <td
              className={`px-4 py-2 text-right font-medium ${
                longPnl >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"
              }`}
            >
              {formatProfit(longPnl)}
            </td>
            <td colSpan={3} className="px-4 py-2 text-right text-muted-foreground">
              —
            </td>
            <td className="px-4 py-2 text-right text-muted-foreground">
              {longCommission !== 0 ? formatProfit(-longCommission) : "—"}
            </td>
          </tr>
          <tr
            onClick={() => onSummaryClick?.("short", shortIds)}
            className={`border-t border-border bg-muted/20 ${onSummaryClick ? "cursor-pointer hover:bg-accent/50 transition-colors" : ""}`}
          >
            <td colSpan={2} className="px-4 py-2 text-right text-muted-foreground font-medium">
              Short
            </td>
            <td colSpan={6} className="px-4 py-2 text-right text-muted-foreground">
              {shortCount} trades
            </td>
            <td
              className={`px-4 py-2 text-right font-medium ${
                shortPnl >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"
              }`}
            >
              {formatProfit(shortPnl)}
            </td>
            <td colSpan={3} className="px-4 py-2 text-right text-muted-foreground">
              —
            </td>
            <td className="px-4 py-2 text-right text-muted-foreground">
              {shortCommission !== 0 ? formatProfit(-shortCommission) : "—"}
            </td>
          </tr>
          <tr
            onClick={() => onSummaryClick?.("all", allIds)}
            className={`border-t-2 border-border bg-muted/30 font-semibold ${onSummaryClick ? "cursor-pointer hover:bg-accent/50 transition-colors" : ""}`}
          >
            <td colSpan={2} className="px-4 py-3 text-right text-foreground">
              Total
            </td>
            <td colSpan={6} className="px-4 py-3 text-right text-foreground">
              {trades.length} trades
            </td>
            <td
              className={`px-4 py-3 text-right font-semibold ${
                totalPnl >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"
              }`}
            >
              {formatProfit(totalPnl)}
            </td>
            <td colSpan={3} className="px-4 py-3 text-right text-muted-foreground">
              —
            </td>
            <td className="px-4 py-3 text-right text-muted-foreground font-semibold">
              {totalCommission !== 0 ? formatProfit(-totalCommission) : "—"}
            </td>
          </tr>
        </tbody>
      </table>
      <div className="flex items-center justify-between gap-4 border-t border-border px-4 py-3">
        <span className="text-sm text-muted-foreground">
          {totalPages > 1 ? (
            <>
              Showing {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, sortedTrades.length)} of {trades.length} trades
            </>
          ) : (
            <>Total: {trades.length} trades</>
          )}
        </span>
        {totalPages > 1 && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, Math.min(totalPages, p - 1)))}
              disabled={currentPage <= 1}
              className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed"
              aria-label="Previous page"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-sm font-medium px-2">
              {currentPage} / {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, Math.min(totalPages, p + 1)))}
              disabled={currentPage >= totalPages}
              className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed"
              aria-label="Next page"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
