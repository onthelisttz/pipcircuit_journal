import type { IDailySummaryRepository } from "@application/ports/repositories";
import type { DailySummary } from "@domain/entities";
import { isOnline } from "@infrastructure/sync/utils/connection";

type DailySummaryBulkUpsertRepo = IDailySummaryRepository & {
  bulkUpsert: (summaries: DailySummary[]) => Promise<void>;
};

type DailySummaryDeleteByAccountAndDateRepo = IDailySummaryRepository & {
  deleteByAccountAndDate: (accountId: string, date: string) => Promise<void>;
};

const hasBulkUpsert = (
  repo: IDailySummaryRepository | null
): repo is DailySummaryBulkUpsertRepo =>
  Boolean(repo && typeof (repo as DailySummaryBulkUpsertRepo).bulkUpsert === "function");

const hasDeleteByAccountAndDate = (
  repo: IDailySummaryRepository | null
): repo is DailySummaryDeleteByAccountAndDateRepo =>
  Boolean(
    repo &&
      typeof (repo as DailySummaryDeleteByAccountAndDateRepo).deleteByAccountAndDate ===
        "function"
  );

/**
 * Dual repository: reads from Dexie, writes to Dexie + Supabase (when online).
 * Real-time sync for daily summaries. Uses accountId + date (no numeric ID mapping).
 */
export class DualDailySummaryRepository implements IDailySummaryRepository {
  constructor(
    private readonly dexie: IDailySummaryRepository,
    private readonly supabase: IDailySummaryRepository | null
  ) {}

  private async syncToSupabase<T>(fn: () => Promise<T>): Promise<void> {
    if (this.supabase && isOnline()) {
      try {
        await fn();
      } catch (err) {
        console.warn("[DualDailySummaryRepo] Supabase sync failed (Dexie updated):", err);
      }
    }
  }

  async getByDate(accountId: string, date: string): Promise<DailySummary | null> {
    return this.dexie.getByDate(accountId, date);
  }

  async listByRange(accountId: string, from: string, to: string): Promise<DailySummary[]> {
    return this.dexie.listByRange(accountId, from, to);
  }

  async create(summary: DailySummary): Promise<DailySummary> {
    const result = await this.dexie.create(summary);
    await this.syncToSupabase(async () => {
      if (hasBulkUpsert(this.supabase)) {
        await this.supabase.bulkUpsert([result]);
      }
    });
    return result;
  }

  async update(id: number, updates: Partial<DailySummary>): Promise<DailySummary> {
    const result = await this.dexie.update(id, updates);
    await this.syncToSupabase(async () => {
      if (hasBulkUpsert(this.supabase)) {
        await this.supabase.bulkUpsert([result]);
      }
    });
    return result;
  }

  async delete(id: number): Promise<void> {
    const summary = this.dexie.getById ? await this.dexie.getById(id) : null;
    await this.dexie.delete(id);
    await this.syncToSupabase(async () => {
      if (summary && hasDeleteByAccountAndDate(this.supabase)) {
        await this.supabase.deleteByAccountAndDate(summary.accountId, summary.date);
      } else if (this.supabase) {
        await this.supabase.delete(id);
      }
    });
  }
}
