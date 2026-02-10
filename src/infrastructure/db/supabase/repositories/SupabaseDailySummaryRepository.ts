import type { IDailySummaryRepository } from "@application/ports/repositories";
import type { DailySummary } from "@domain/entities";
import { getSupabaseClient } from "../client";

interface SupabaseDailySummary {
  id: number;
  user_id: string;
  account_id: string;
  date: string;
  net_profit: number;
  gross_profit: number;
  trades_count: number;
  wins: number;
  losses: number;
  win_rate: number;
  max_drawdown: number;
  average_win: number;
  average_loss: number;
  created_at: string;
  updated_at: string;
}

function toDomain(row: SupabaseDailySummary): DailySummary {
  return {
    id: row.id,
    accountId: row.account_id,
    date: row.date,
    netProfit: Number(row.net_profit),
    grossProfit: Number(row.gross_profit),
    tradesCount: row.trades_count,
    wins: row.wins,
    losses: row.losses,
    winRate: Number(row.win_rate),
    maxDrawdown: Number(row.max_drawdown),
    averageWin: Number(row.average_win),
    averageLoss: Number(row.average_loss),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function toSupabase(s: DailySummary, userId: string): Record<string, unknown> {
  return {
    user_id: userId,
    account_id: s.accountId,
    date: s.date,
    net_profit: s.netProfit,
    gross_profit: s.grossProfit,
    trades_count: s.tradesCount,
    wins: s.wins,
    losses: s.losses,
    win_rate: s.winRate,
    max_drawdown: s.maxDrawdown,
    average_win: s.averageWin,
    average_loss: s.averageLoss,
    created_at: s.createdAt instanceof Date ? s.createdAt.toISOString() : new Date(s.createdAt).toISOString(),
    updated_at: s.updatedAt instanceof Date ? s.updatedAt.toISOString() : new Date(s.updatedAt).toISOString(),
  };
}

export class SupabaseDailySummaryRepository implements IDailySummaryRepository {
  constructor(private readonly userId: string) {}

  async getByDate(accountId: string, date: string): Promise<DailySummary | null> {
    const { data, error } = await getSupabaseClient()
      .from("daily_summaries")
      .select("*")
      .eq("user_id", this.userId)
      .eq("account_id", accountId)
      .eq("date", date)
      .single();

    if (error || !data) return null;
    return toDomain(data as SupabaseDailySummary);
  }

  async listByRange(accountId: string, from: string, to: string): Promise<DailySummary[]> {
    const { data, error } = await getSupabaseClient()
      .from("daily_summaries")
      .select("*")
      .eq("user_id", this.userId)
      .eq("account_id", accountId)
      .gte("date", from)
      .lte("date", to)
      .order("date", { ascending: true });

    if (error) throw new Error(`Failed to fetch daily summaries: ${error.message}`);
    return (data ?? []).map((r) => toDomain(r as SupabaseDailySummary));
  }

  async create(summary: DailySummary): Promise<DailySummary> {
    const row = toSupabase(summary, this.userId);
    const { data, error } = await getSupabaseClient()
      .from("daily_summaries")
      .insert(row)
      .select("id")
      .single();

    if (error) throw new Error(`Failed to create daily summary: ${error.message}`);
    return { ...summary, id: (data as { id: number }).id };
  }

  async update(id: number, updates: Partial<DailySummary>): Promise<DailySummary> {
    const supabaseUpdates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (updates.netProfit !== undefined) supabaseUpdates.net_profit = updates.netProfit;
    if (updates.grossProfit !== undefined) supabaseUpdates.gross_profit = updates.grossProfit;
    if (updates.tradesCount !== undefined) supabaseUpdates.trades_count = updates.tradesCount;
    if (updates.wins !== undefined) supabaseUpdates.wins = updates.wins;
    if (updates.losses !== undefined) supabaseUpdates.losses = updates.losses;
    if (updates.winRate !== undefined) supabaseUpdates.win_rate = updates.winRate;
    if (updates.maxDrawdown !== undefined) supabaseUpdates.max_drawdown = updates.maxDrawdown;
    if (updates.averageWin !== undefined) supabaseUpdates.average_win = updates.averageWin;
    if (updates.averageLoss !== undefined) supabaseUpdates.average_loss = updates.averageLoss;

    const { error } = await getSupabaseClient()
      .from("daily_summaries")
      .update(supabaseUpdates)
      .eq("user_id", this.userId)
      .eq("id", id);

    if (error) throw new Error(`Failed to update daily summary: ${error.message}`);
    const { data } = await getSupabaseClient()
      .from("daily_summaries")
      .select("*")
      .eq("user_id", this.userId)
      .eq("id", id)
      .single();
    if (!data) throw new Error(`Daily summary not found: ${id}`);
    return toDomain(data as SupabaseDailySummary);
  }

  async delete(id: number): Promise<void> {
    const { error } = await getSupabaseClient()
      .from("daily_summaries")
      .delete()
      .eq("user_id", this.userId)
      .eq("id", id);

    if (error) throw new Error(`Failed to delete daily summary: ${error.message}`);
  }

  /** Delete by account + date (used when Dexie id differs from Supabase) */
  async deleteByAccountAndDate(accountId: string, date: string): Promise<void> {
    const { error } = await getSupabaseClient()
      .from("daily_summaries")
      .delete()
      .eq("user_id", this.userId)
      .eq("account_id", accountId)
      .eq("date", date);

    if (error) throw new Error(`Failed to delete daily summary: ${error.message}`);
  }

  async listAll(): Promise<DailySummary[]> {
    const { data, error } = await getSupabaseClient()
      .from("daily_summaries")
      .select("*")
      .eq("user_id", this.userId)
      .order("date", { ascending: true });

    if (error) throw new Error(`Failed to list daily summaries: ${error.message}`);
    return (data ?? []).map((r) => toDomain(r as SupabaseDailySummary));
  }

  async bulkUpsert(summaries: DailySummary[]): Promise<void> {
    if (summaries.length === 0) return;
    const rows = summaries.map((s) => toSupabase(s, this.userId));
    const { error } = await getSupabaseClient()
      .from("daily_summaries")
      .upsert(rows, { onConflict: "user_id,account_id,date", ignoreDuplicates: false });
    if (error) throw new Error(`Failed to upsert daily summaries: ${error.message}`);
  }
}
