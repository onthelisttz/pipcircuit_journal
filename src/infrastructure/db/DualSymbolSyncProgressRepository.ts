import type { ISymbolSyncProgressRepository } from "@application/ports/repositories";
import type { SymbolSyncProgress, SymbolSyncStatus } from "@domain/entities";
import { isOnline } from "@infrastructure/sync/utils/connection";

/**
 * Updates both Dexie (local) and Supabase (cloud) when online.
 * Ensures progress stays in sync across devices.
 */
export class DualSymbolSyncProgressRepository implements ISymbolSyncProgressRepository {
  constructor(
    private readonly dexie: ISymbolSyncProgressRepository,
    private readonly supabase: ISymbolSyncProgressRepository | null
  ) {}

  private async syncToSupabase(
    fn: () => Promise<void>
  ): Promise<void> {
    if (this.supabase && isOnline()) {
      try {
        await fn();
      } catch (err) {
        console.warn("[DualProgressRepo] Supabase update failed (Dexie still updated):", err);
      }
    }
  }

  async getByBrokerAndSymbol(
    broker: string,
    symbol: string
  ): Promise<SymbolSyncProgress | null> {
    return this.dexie.getByBrokerAndSymbol(broker, symbol);
  }

  async getByBroker(broker: string): Promise<SymbolSyncProgress[]> {
    return this.dexie.getByBroker(broker);
  }

  async getAll(): Promise<SymbolSyncProgress[]> {
    return this.dexie.getAll();
  }

  async getByStatus(status: SymbolSyncStatus): Promise<SymbolSyncProgress[]> {
    return this.dexie.getByStatus(status);
  }

  async upsert(progress: SymbolSyncProgress): Promise<void> {
    await this.dexie.upsert(progress);
    await this.syncToSupabase(() => this.supabase!.upsert(progress));
  }

  async updateStatus(
    broker: string,
    symbol: string,
    status: SymbolSyncStatus,
    error?: string | null
  ): Promise<void> {
    await this.dexie.updateStatus(broker, symbol, status, error);
    await this.syncToSupabase(async () => {
      const current = await this.dexie.getByBrokerAndSymbol(broker, symbol);
      if (current) {
        await this.supabase!.upsert(current);
      }
    });
  }

  async updateProgress(
    broker: string,
    symbol: string,
    updates: Partial<SymbolSyncProgress>
  ): Promise<void> {
    await this.dexie.updateProgress(broker, symbol, updates);
    await this.syncToSupabase(async () => {
      const current = await this.dexie.getByBrokerAndSymbol(broker, symbol);
      if (current) {
        await this.supabase!.upsert(current);
      }
    });
  }

  async delete(broker: string, symbol: string): Promise<void> {
    await this.dexie.delete(broker, symbol);
    await this.syncToSupabase(() => this.supabase!.delete(broker, symbol));
  }

  async deleteByBroker(broker: string): Promise<void> {
    await this.dexie.deleteByBroker(broker);
    await this.syncToSupabase(() => this.supabase!.deleteByBroker(broker));
  }
}
