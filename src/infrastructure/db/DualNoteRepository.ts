import type { INoteRepository } from "@application/ports/repositories";
import type { TradeNote } from "@domain/entities";
import { isOnline } from "@infrastructure/sync/utils/connection";

type TradeResolver = (dexieTradeId: number) => Promise<number | null>;

/**
 * Dual repository: reads from Dexie, writes to Dexie + Supabase (when online).
 * Real-time sync for trade notes. Resolves Dexie trade id to Supabase trade id for FK.
 */
export class DualNoteRepository implements INoteRepository {
  constructor(
    private readonly dexie: INoteRepository,
    private readonly supabase: INoteRepository | null,
    private readonly resolveTradeId: TradeResolver | null
  ) {}

  private async syncToSupabase<T>(fn: () => Promise<T>): Promise<void> {
    if (this.supabase && isOnline()) {
      try {
        await fn();
      } catch (err) {
        console.warn("[DualNoteRepo] Supabase sync failed (Dexie updated):", err);
      }
    }
  }

  async getById(id: number): Promise<TradeNote | null> {
    return this.dexie.getById(id);
  }

  async listByTradeId(tradeId: number): Promise<TradeNote[]> {
    return this.dexie.listByTradeId(tradeId);
  }

  async create(note: TradeNote): Promise<TradeNote> {
    const result = await this.dexie.create(note);
    await this.syncToSupabase(async () => {
      const supabaseTradeId = this.resolveTradeId ? await this.resolveTradeId(note.tradeId) : null;
      if (supabaseTradeId != null) {
        await this.supabase!.create({ ...result, tradeId: supabaseTradeId });
      }
    });
    return result;
  }

  async update(id: number, updates: Partial<TradeNote>): Promise<TradeNote> {
    return this.dexie.update(id, updates);
    // Update sync deferred to periodic FullSyncService (note id mapping is complex)
  }

  async delete(id: number): Promise<void> {
    await this.dexie.delete(id);
    // Delete sync deferred to periodic FullSyncService
  }
}
