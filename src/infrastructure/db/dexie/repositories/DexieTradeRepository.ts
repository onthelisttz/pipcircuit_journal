import type { ITradeRepository, TradeQuery } from "@application/ports/repositories";
import type { Trade } from "@domain/entities";
import { Direction, TradeOutcome } from "@domain/enums";
import { db } from "../database";
import { estimateGrossProfit, volumeToLots } from "@lib/pnl-estimate";

/** IndexedDB/Dexie can return dates as ISO strings; normalize to timestamp for comparison. */
function toTimeMs(value: Date | string | undefined | null): number {
  if (value == null) return 0;
  if (value instanceof Date) return value.getTime();
  const ms = new Date(value as string).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function toDate(value: Date | string | undefined | null): Date | undefined {
  if (value == null) return undefined;
  if (value instanceof Date) return value;
  const d = new Date(value as string);
  return Number.isFinite(d.getTime()) ? d : undefined;
}

/** Enrich trade with estimated P&L when closed. Preserve API grossProfit when valid (for indices). */
function enrichWithEstimatedPnl(t: Trade): Trade {
  if (!t.closeTime) return t;

  const existingGross = t.grossProfit;
  if (existingGross != null && Number.isFinite(existingGross)) {
    const net = existingGross + (t.commission ?? 0) + (t.swap ?? 0) + (t.fee ?? 0);
    return { ...t, netProfit: net };
  }

  const entry = t.entryPrice ?? t.openPrice;
  const close = t.closePrice ?? t.openPrice;
  // Prefer explicit lots when present; fall back to converting volume.
  const vol =
    t.lots != null && Number.isFinite(t.lots)
      ? t.lots
      : volumeToLots(t.volume ?? 0, t.symbol ?? "");
  if (!Number.isFinite(entry) || !Number.isFinite(close) || vol <= 0) return t;

  const closingDir = t.direction === Direction.Sell ? "Sell" : "Buy";
  const openingDir = closingDir === "Sell" ? "Buy" : "Sell";
  const gross = estimateGrossProfit(entry, close, vol, openingDir, t.symbol ?? "");
  const net = gross + (t.commission ?? 0) + (t.swap ?? 0) + (t.fee ?? 0);

  return { ...t, grossProfit: gross, netProfit: net };
}

/** Ensure trade dates are Date objects and P&L is populated (estimated if missing). */
function normalizeTrade(t: Trade): Trade {
  const openTime = toDate(t.openTime as Date | string);
  const closeTime = toDate(t.closeTime as Date | string | null | undefined);
  const normalized: Trade = {
    ...t,
    openTime: openTime ?? new Date(0),
    closeTime: closeTime ?? (t.closeTime ?? null),
  };
  return enrichWithEstimatedPnl(normalized);
}

export class DexieTradeRepository implements ITradeRepository {
  async getById(id: number): Promise<Trade | null> {
    const t = await db.trades.get(id);
    return t ? normalizeTrade(t) : null;
  }

  async list(query?: TradeQuery): Promise<Trade[]> {
    if (!query) {
      const list = await db.trades.toArray();
      return list.map(normalizeTrade);
    }

    let results = await db.trades.toArray();

    if (query.ids && query.ids.length > 0) {
      const idSet = new Set(query.ids);
      results = results.filter((t) => t.id != null && idSet.has(t.id));
    }
    if (query.accountId) {
      results = results.filter((trade) => trade.accountId === query.accountId);
    }
    if (query.symbol) {
      results = results.filter((trade) => trade.symbol === query.symbol);
    }
    if (query.symbols && query.symbols.length > 0) {
      const set = new Set(query.symbols);
      results = results.filter((trade) => set.has(trade.symbol));
    }
    if (query.direction) {
      results = results.filter((trade) => trade.direction === query.direction);
    }
    if (query.outcome) {
      if (query.outcome === TradeOutcome.Breakeven) {
        results = results.filter((t) => {
          if (!t.closeTime) return false;
          const p = t.netProfit ?? t.grossProfit ?? 0;
          return p === 0;
        });
      } else {
        results = results.filter((trade) => trade.outcome === query.outcome);
      }
    }
    if (query.from || query.to) {
      const fromTime = query.from
        ? (query.from instanceof Date ? query.from.getTime() : new Date(query.from).getTime())
        : 0;
      const toTime = query.to
        ? (query.to instanceof Date ? query.to.getTime() : new Date(query.to).getTime())
        : Number.MAX_SAFE_INTEGER;
      results = results.filter((trade) => {
        // Use closeTime for closed trades (when P&L realized), openTime for open trades
        const tradeTime = toTimeMs(trade.closeTime as Date | string | null) || toTimeMs(trade.openTime as Date | string);
        return tradeTime >= fromTime && tradeTime <= toTime;
      });
    }
    if (query.tagIds && query.tagIds.length > 0) {
      const tradeTags = await db.trade_tags
        .where("tagId")
        .anyOf(query.tagIds)
        .toArray();
      const tradeIdSet = new Set(tradeTags.map((entry) => entry.tradeId));
      results = results.filter((trade) => trade.id && tradeIdSet.has(trade.id));
    }
    if (query.ratingMin !== undefined) {
      results = results.filter(
        (trade) => (trade.rating ?? 0) >= query.ratingMin!
      );
    }
    if (query.ratingMax !== undefined) {
      results = results.filter(
        (trade) => (trade.rating ?? 0) <= query.ratingMax!
      );
    }
    if (query.winsOnly) {
      results = results.filter((t) => {
        if (!t.closeTime) return false;
        const p = t.netProfit ?? t.grossProfit ?? 0;
        return p > 0;
      });
    }
    if (query.lossesOnly) {
      results = results.filter((t) => {
        if (!t.closeTime) return false;
        const p = t.netProfit ?? t.grossProfit ?? 0;
        return p < 0;
      });
    }

    return results.map(normalizeTrade);
  }

  async getByAccountId(accountId: string): Promise<Trade[]> {
    const list = await db.trades.where("accountId").equals(accountId).toArray();
    return list.map(normalizeTrade);
  }

  async create(trade: Trade): Promise<Trade> {
    const id = await db.trades.add(trade);
    return { ...trade, id };
  }

  async update(id: number, updates: Partial<Trade>): Promise<Trade> {
    await db.trades.update(id, updates);
    const updated = await db.trades.get(id);
    if (!updated) {
      throw new Error(`Trade not found: ${id}`);
    }
    return updated;
  }

  async delete(id: number): Promise<void> {
    await db.trades.delete(id);
  }

  async bulkUpsert(trades: Trade[]): Promise<void> {
    if (trades.length === 0) {
      return;
    }

    // Dexie uses the primary key (`id`) for upsert. Our imported cTrader trades
    // often arrive without `id`, so bulkPut would create duplicates on each sync.
    // To make syncing idempotent, we match existing records by (accountId + ticketId)
    // and reuse their `id` when found.
    const accountIds = Array.from(
      new Set(trades.map((t) => t.accountId).filter(Boolean))
    );

    const existingByKey = new Map<string, number>();
    for (const accountId of accountIds) {
      const existing = await db.trades.where("accountId").equals(accountId).toArray();
      for (const trade of existing) {
        if (!trade.ticketId || !trade.id) continue;
        existingByKey.set(`${accountId}::${trade.ticketId}`, trade.id);
      }
    }

    const normalized = trades.map((t) => {
      const key = t.ticketId ? `${t.accountId}::${t.ticketId}` : "";
      const id = key ? existingByKey.get(key) : undefined;
      return id ? { ...t, id } : t;
    });

    await db.trades.bulkPut(normalized);
  }
}
