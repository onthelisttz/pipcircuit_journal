import type { ITradeRepository, TradeQuery } from "@application/ports/repositories";
import type { Trade } from "@domain/entities";
import { db } from "../database";

export class DexieTradeRepository implements ITradeRepository {
  async getById(id: number): Promise<Trade | null> {
    return (await db.trades.get(id)) ?? null;
  }

  async list(query?: TradeQuery): Promise<Trade[]> {
    if (!query) {
      return db.trades.toArray();
    }

    let results = await db.trades.toArray();

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
      results = results.filter((trade) => trade.outcome === query.outcome);
    }
    if (query.from) {
      const fromTime = query.from.getTime();
      results = results.filter((trade) => trade.openTime.getTime() >= fromTime);
    }
    if (query.to) {
      const toTime = query.to.getTime();
      results = results.filter((trade) => trade.openTime.getTime() <= toTime);
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

    return results;
  }

  async getByAccountId(accountId: string): Promise<Trade[]> {
    return db.trades.where("accountId").equals(accountId).toArray();
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
    await db.trades.bulkPut(trades);
  }
}
