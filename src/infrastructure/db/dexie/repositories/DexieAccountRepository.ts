import type { IAccountRepository } from "@application/ports/repositories";
import type { Account } from "@domain/entities";
import { db } from "../database";

export class DexieAccountRepository implements IAccountRepository {
  async getById(id: number): Promise<Account | null> {
    return (await db.accounts.get(id)) ?? null;
  }

  async getByAccountNumber(accountNumber: string): Promise<Account | null> {
    return (await db.accounts.where("accountNumber").equals(accountNumber).first()) ?? null;
  }

  async list(): Promise<Account[]> {
    return db.accounts.toArray();
  }

  async create(account: Account): Promise<Account> {
    const id = await db.accounts.add(account);
    return { ...account, id };
  }

  async update(id: number, updates: Partial<Account>): Promise<Account> {
    await db.accounts.update(id, updates);
    const updated = await db.accounts.get(id);
    if (!updated) {
      throw new Error(`Account not found: ${id}`);
    }
    return updated;
  }

  async delete(id: number): Promise<void> {
    await db.accounts.delete(id);
  }

  async setActive(accountId: number): Promise<void> {
    await db.transaction("rw", db.accounts, async () => {
      await db.accounts.toCollection().modify({ isActive: false });
      await db.accounts.update(accountId, { isActive: true });
    });
  }
}
