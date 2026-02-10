import type { ITradeRepository, TradeQuery } from "@application/ports/repositories";
import type { Trade } from "@domain/entities";
import { isOnline } from "@infrastructure/sync/utils/connection";

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
      if ("bulkUpsert" in (this.supabase as { bulkUpsert?: (t: Trade[]) => Promise<void> })) {
        await (this.supabase as { bulkUpsert: (t: Trade[]) => Promise<void> }).bulkUpsert([result]);
      }
    });
    return result;
  }

  async update(id: number, updates: Partial<Trade>): Promise<Trade> {
    const result = await this.dexie.update(id, updates);
    await this.syncToSupabase(async () => {
      if ("bulkUpsert" in (this.supabase as { bulkUpsert?: (t: Trade[]) => Promise<void> })) {
        await (this.supabase as { bulkUpsert: (t: Trade[]) => Promise<void> }).bulkUpsert([result]);
      }
    });
    return result;
  }

  async delete(id: number): Promise<void> {
    const trade = await this.dexie.getById(id);
    await this.dexie.delete(id);
    await this.syncToSupabase(async () => {
      if (trade?.accountId && trade?.ticketId && "deleteByAccountAndTicket" in (this.supabase as unknown as Record<string, unknown>)) {
        await (this.supabase as unknown as { deleteByAccountAndTicket: (a: string, t: string) => Promise<void> }).deleteByAccountAndTicket(trade.accountId, trade.ticketId);
      }
    });
  }

  async bulkUpsert(trades: Trade[]): Promise<void> {
    await this.dexie.bulkUpsert(trades);
    await this.syncToSupabase(() => (this.supabase as { bulkUpsert: (t: Trade[]) => Promise<void> }).bulkUpsert(trades));
  }
}
