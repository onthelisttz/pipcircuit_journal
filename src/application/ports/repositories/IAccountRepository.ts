import type { Account } from "@domain/entities";

export interface IAccountRepository {
  getById(id: number): Promise<Account | null>;
  getByAccountNumber(accountNumber: string): Promise<Account | null>;
  list(): Promise<Account[]>;
  create(account: Account): Promise<Account>;
  update(id: number, updates: Partial<Account>): Promise<Account>;
  delete(id: number): Promise<void>;
  setActive(accountId: number): Promise<void>;
}
