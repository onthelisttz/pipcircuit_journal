import type { IAccountRepository } from "@application/ports/repositories";
import type { Account } from "@domain/entities";
import { isOnline } from "@infrastructure/sync/utils/connection";

type AccountBulkUpsertRepo = IAccountRepository & {
  bulkUpsert: (accounts: Account[]) => Promise<void>;
};

type AccountDeleteByNumberRepo = IAccountRepository & {
  deleteByAccountNumber: (accountNumber: string) => Promise<void>;
};

type AccountSetActiveByNumberRepo = IAccountRepository & {
  setActiveByAccountNumber: (accountNumber: string) => Promise<void>;
};

const hasBulkUpsert = (
  repo: IAccountRepository | null
): repo is AccountBulkUpsertRepo =>
  Boolean(repo && typeof (repo as AccountBulkUpsertRepo).bulkUpsert === "function");

const hasDeleteByAccountNumber = (
  repo: IAccountRepository | null
): repo is AccountDeleteByNumberRepo =>
  Boolean(
    repo &&
      typeof (repo as AccountDeleteByNumberRepo).deleteByAccountNumber === "function"
  );

const hasSetActiveByAccountNumber = (
  repo: IAccountRepository | null
): repo is AccountSetActiveByNumberRepo =>
  Boolean(
    repo &&
      typeof (repo as AccountSetActiveByNumberRepo).setActiveByAccountNumber === "function"
  );

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
      if (hasBulkUpsert(this.supabase)) {
        await this.supabase.bulkUpsert([result]);
      }
    });
    return result;
  }

  async update(id: number, updates: Partial<Account>): Promise<Account> {
    const result = await this.dexie.update(id, updates);
    await this.syncToSupabase(async () => {
      if (hasBulkUpsert(this.supabase)) {
        await this.supabase.bulkUpsert([result]);
      }
    });
    return result;
  }

  async delete(id: number): Promise<void> {
    const account = await this.dexie.getById(id);
    await this.dexie.delete(id);
    await this.syncToSupabase(async () => {
      if (account && hasDeleteByAccountNumber(this.supabase)) {
        await this.supabase.deleteByAccountNumber(account.accountNumber);
      } else if (this.supabase) {
        await this.supabase.delete(id);
      }
    });
  }

  async setActive(accountId: number): Promise<void> {
    const account = await this.dexie.getById(accountId);
    await this.dexie.setActive(accountId);
    await this.syncToSupabase(async () => {
      if (account && hasSetActiveByAccountNumber(this.supabase)) {
        await this.supabase.setActiveByAccountNumber(account.accountNumber);
      } else if (this.supabase) {
        await this.supabase.setActive(accountId);
      }
    });
  }
}
