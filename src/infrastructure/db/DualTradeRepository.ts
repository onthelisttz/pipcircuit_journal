import type { ITradeRepository, TradeQuery } from "@application/ports/repositories";
import type { Trade } from "@domain/entities";
import { isOnline } from "@infrastructure/sync/utils/connection";

type TradeBulkUpsertRepo = ITradeRepository & {
  bulkUpsert: (trades: Trade[]) => Promise<void>;
};

type TradeDeleteByAccountAndTicketRepo = ITradeRepository & {
  deleteByAccountAndTicket: (accountId: string, ticketId: string) => Promise<void>;
};

const hasBulkUpsert = (
  repo: ITradeRepository | null
): repo is TradeBulkUpsertRepo =>
  Boolean(repo && typeof (repo as TradeBulkUpsertRepo).bulkUpsert === "function");

const hasDeleteByAccountAndTicket = (
  repo: ITradeRepository | null
): repo is TradeDeleteByAccountAndTicketRepo =>
  Boolean(
    repo &&
      typeof (repo as TradeDeleteByAccountAndTicketRepo).deleteByAccountAndTicket ===
        "function"
  );

/**
 * Dual repository: reads from Dexie, writes to Dexie + Supabase (when online).
 * Real-time sync for trades.
 */
export class DualTradeRepository implements ITradeRepository {
  constructor(
    private readonly dexie: ITradeRepository,
    private readonly supabase: ITradeRepository | null
  ) {}

  private async syncToSupabase<T>(fn: () => Promise<T>): Promise<void> {
    if (this.supabase && isOnline()) {
      try {
        await fn();
      } catch (err) {
        console.warn("[DualTradeRepo] Supabase sync failed (Dexie updated):", err);
      }
    }
  }

  async getById(id: number): Promise<Trade | null> {
    return this.dexie.getById(id);
  }

  async list(query?: TradeQuery): Promise<Trade[]> {
    return this.dexie.list(query);
  }

  async getByAccountId(accountId: string): Promise<Trade[]> {
    return this.dexie.getByAccountId(accountId);
  }

  async create(trade: Trade): Promise<Trade> {
    const result = await this.dexie.create(trade);
    await this.syncToSupabase(async () => {
      if (hasBulkUpsert(this.supabase)) {
        await this.supabase.bulkUpsert([result]);
      }
    });
    return result;
  }

  async update(id: number, updates: Partial<Trade>): Promise<Trade> {
    const result = await this.dexie.update(id, updates);
    await this.syncToSupabase(async () => {
      if (hasBulkUpsert(this.supabase)) {
        await this.supabase.bulkUpsert([result]);
      }
    });
    return result;
  }

  async delete(id: number): Promise<void> {
    const trade = await this.dexie.getById(id);
    await this.dexie.delete(id);
    await this.syncToSupabase(async () => {
      if (trade?.accountId && trade?.ticketId && hasDeleteByAccountAndTicket(this.supabase)) {
        await this.supabase.deleteByAccountAndTicket(trade.accountId, trade.ticketId);
      }
    });
  }

  async bulkUpsert(trades: Trade[]): Promise<void> {
    await this.dexie.bulkUpsert(trades);
    await this.syncToSupabase(async () => {
      if (hasBulkUpsert(this.supabase)) {
        await this.supabase.bulkUpsert(trades);
      }
    });
  }
}
