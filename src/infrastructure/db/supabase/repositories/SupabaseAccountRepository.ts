import type { IAccountRepository } from "@application/ports/repositories";
import type { Account } from "@domain/entities";
import { getSupabaseClient } from "../client";

interface SupabaseAccount {
  id: number;
  user_id: string;
  ctrader_account_id: number | null;
  account_number: string;
  platform: string;
  broker: string | null;
  server: string | null;
  name: string | null;
  type: string | null;
  currency: string | null;
  balance: number | null;
  equity: number | null;
  leverage: number | null;
  is_active: boolean | null;
  last_sync_at: string | null;
  created_at: string;
  updated_at: string;
}

function toDomain(row: SupabaseAccount): Account {
  return {
    id: row.id,
    ctraderAccountId: row.ctrader_account_id ?? undefined,
    accountNumber: row.account_number,
    platform: row.platform,
    broker: row.broker ?? undefined,
    server: row.server ?? undefined,
    name: row.name ?? undefined,
    type: row.type as Account["type"],
    currency: row.currency ?? undefined,
    balance: row.balance ?? undefined,
    equity: row.equity ?? undefined,
    leverage: row.leverage ?? undefined,
    isActive: row.is_active ?? undefined,
    lastSyncAt: row.last_sync_at ? new Date(row.last_sync_at) : null,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function toSupabase(a: Account, userId: string): Record<string, unknown> {
  return {
    user_id: userId,
    ctrader_account_id: a.ctraderAccountId ?? null,
    account_number: a.accountNumber,
    platform: a.platform,
    broker: a.broker ?? null,
    server: a.server ?? null,
    name: a.name ?? null,
    type: a.type ?? null,
    currency: a.currency ?? null,
    balance: a.balance ?? null,
    equity: a.equity ?? null,
    leverage: a.leverage ?? null,
    is_active: a.isActive ?? null,
    last_sync_at: a.lastSyncAt ? (a.lastSyncAt instanceof Date ? a.lastSyncAt.toISOString() : new Date(a.lastSyncAt).toISOString()) : null,
    created_at: a.createdAt instanceof Date ? a.createdAt.toISOString() : new Date(a.createdAt).toISOString(),
    updated_at: a.updatedAt instanceof Date ? a.updatedAt.toISOString() : new Date(a.updatedAt).toISOString(),
  };
}

export class SupabaseAccountRepository implements IAccountRepository {
  constructor(private readonly userId: string) {}

  async getById(id: number): Promise<Account | null> {
    const { data, error } = await getSupabaseClient()
      .from("accounts")
      .select("*")
      .eq("user_id", this.userId)
      .eq("id", id)
      .single();

    if (error || !data) return null;
    return toDomain(data as SupabaseAccount);
  }

  async getByAccountNumber(accountNumber: string): Promise<Account | null> {
    const { data, error } = await getSupabaseClient()
      .from("accounts")
      .select("*")
      .eq("user_id", this.userId)
      .eq("account_number", accountNumber)
      .single();

    if (error || !data) return null;
    return toDomain(data as SupabaseAccount);
  }

  async list(): Promise<Account[]> {
    const { data, error } = await getSupabaseClient()
      .from("accounts")
      .select("*")
      .eq("user_id", this.userId)
      .order("account_number", { ascending: true });

    if (error) throw new Error(`Failed to fetch accounts: ${error.message}`);
    return (data ?? []).map((r) => toDomain(r as SupabaseAccount));
  }

  async create(account: Account): Promise<Account> {
    const row = toSupabase(account, this.userId);
    const { data, error } = await getSupabaseClient()
      .from("accounts")
      .insert(row)
      .select("id")
      .single();

    if (error) throw new Error(`Failed to create account: ${error.message}`);
    return { ...account, id: (data as { id: number }).id };
  }

  async update(id: number, updates: Partial<Account>): Promise<Account> {
    const supabaseUpdates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (updates.broker !== undefined) supabaseUpdates.broker = updates.broker;
    if (updates.server !== undefined) supabaseUpdates.server = updates.server;
    if (updates.name !== undefined) supabaseUpdates.name = updates.name;
    if (updates.type !== undefined) supabaseUpdates.type = updates.type;
    if (updates.currency !== undefined) supabaseUpdates.currency = updates.currency;
    if (updates.balance !== undefined) supabaseUpdates.balance = updates.balance;
    if (updates.equity !== undefined) supabaseUpdates.equity = updates.equity;
    if (updates.leverage !== undefined) supabaseUpdates.leverage = updates.leverage;
    if (updates.isActive !== undefined) supabaseUpdates.is_active = updates.isActive;
    if (updates.lastSyncAt !== undefined) {
      supabaseUpdates.last_sync_at = updates.lastSyncAt ? new Date(updates.lastSyncAt).toISOString() : null;
    }

    const { error } = await getSupabaseClient()
      .from("accounts")
      .update(supabaseUpdates)
      .eq("user_id", this.userId)
      .eq("id", id);

    if (error) throw new Error(`Failed to update account: ${error.message}`);
    const updated = await this.getById(id);
    if (!updated) throw new Error(`Account not found: ${id}`);
    return updated;
  }

  async delete(id: number): Promise<void> {
    const { error } = await getSupabaseClient()
      .from("accounts")
      .delete()
      .eq("user_id", this.userId)
      .eq("id", id);

    if (error) throw new Error(`Failed to delete account: ${error.message}`);
  }

  /** Delete by account number (used when Dexie id differs from Supabase) */
  async deleteByAccountNumber(accountNumber: string): Promise<void> {
    const { error } = await getSupabaseClient()
      .from("accounts")
      .delete()
      .eq("user_id", this.userId)
      .eq("account_number", accountNumber);

    if (error) throw new Error(`Failed to delete account: ${error.message}`);
  }

  async setActive(accountId: number): Promise<void> {
    await getSupabaseClient()
      .from("accounts")
      .update({ is_active: false })
      .eq("user_id", this.userId);
    await getSupabaseClient()
      .from("accounts")
      .update({ is_active: true })
      .eq("user_id", this.userId)
      .eq("id", accountId);
  }

  /** Set active by account number (used when Dexie id differs from Supabase) */
  async setActiveByAccountNumber(accountNumber: string): Promise<void> {
    await getSupabaseClient()
      .from("accounts")
      .update({ is_active: false })
      .eq("user_id", this.userId);
    await getSupabaseClient()
      .from("accounts")
      .update({ is_active: true })
      .eq("user_id", this.userId)
      .eq("account_number", accountNumber);
  }

  /** List all for sync */
  async listAll(): Promise<Account[]> {
    return this.list();
  }

  /** Bulk upsert for sync */
  async bulkUpsert(accounts: Account[]): Promise<void> {
    if (accounts.length === 0) return;
    const rows = accounts.map((a) => toSupabase(a, this.userId));
    const { error } = await getSupabaseClient()
      .from("accounts")
      .upsert(rows, { onConflict: "user_id,account_number", ignoreDuplicates: false });
    if (error) throw new Error(`Failed to upsert accounts: ${error.message}`);
  }
}
