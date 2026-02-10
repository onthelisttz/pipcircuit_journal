import type { IAccountRepository } from "@application/ports/repositories";
import type { Account } from "@domain/entities";
import { isOnline } from "@infrastructure/sync/utils/connection";

/**
 * Dual repository: reads from Dexie, writes to Dexie + Supabase (when online).
 * Real-time sync for accounts.
 */
export class DualAccountRepository implements IAccountRepository {
  constructor(
    private readonly dexie: IAccountRepository,
    private readonly supabase: IAccountRepository | null
  ) {}

  private async syncToSupabase<T>(fn: () => Promise<T>): Promise<void> {
    if (this.supabase && isOnline()) {
      try {
        await fn();
      } catch (err) {
        console.warn("[DualAccountRepo] Supabase sync failed (Dexie updated):", err);
      }
    }
  }

  async getById(id: number): Promise<Account | null> {
    return this.dexie.getById(id);
  }

  async getByAccountNumber(accountNumber: string): Promise<Account | null> {
    return this.dexie.getByAccountNumber(accountNumber);
  }

  async list(): Promise<Account[]> {
    return this.dexie.list();
  }

  async create(account: Account): Promise<Account> {
    const result = await this.dexie.create(account);
    await this.syncToSupabase(async () => {
      if ("bulkUpsert" in (this.supabase as { bulkUpsert?: (a: Account[]) => Promise<void> })) {
        await (this.supabase as { bulkUpsert: (a: Account[]) => Promise<void> }).bulkUpsert([result]);
      }
    });
    return result;
  }

  async update(id: number, updates: Partial<Account>): Promise<Account> {
    const result = await this.dexie.update(id, updates);
    await this.syncToSupabase(async () => {
      if ("bulkUpsert" in (this.supabase as { bulkUpsert?: (a: Account[]) => Promise<void> })) {
        await (this.supabase as { bulkUpsert: (a: Account[]) => Promise<void> }).bulkUpsert([result]);
      }
    });
    return result;
  }

  async delete(id: number): Promise<void> {
    const account = await this.dexie.getById(id);
    await this.dexie.delete(id);
    await this.syncToSupabase(async () => {
      if (account && "deleteByAccountNumber" in (this.supabase as { deleteByAccountNumber?: (a: string) => Promise<void> })) {
        await (this.supabase as { deleteByAccountNumber: (a: string) => Promise<void> }).deleteByAccountNumber(account.accountNumber);
      } else {
        await this.supabase!.delete(id);
      }
    });
  }

  async setActive(accountId: number): Promise<void> {
    const account = await this.dexie.getById(accountId);
    await this.dexie.setActive(accountId);
    await this.syncToSupabase(async () => {
      if (account && "setActiveByAccountNumber" in (this.supabase as { setActiveByAccountNumber?: (a: string) => Promise<void> })) {
        await (this.supabase as { setActiveByAccountNumber: (a: string) => Promise<void> }).setActiveByAccountNumber(account.accountNumber);
      } else {
        await this.supabase!.setActive(accountId);
      }
    });
  }
}
