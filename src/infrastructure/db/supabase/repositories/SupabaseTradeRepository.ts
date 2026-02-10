import type { ITradeRepository, TradeQuery } from "@application/ports/repositories";
import type { Trade } from "@domain/entities";
import { getSupabaseClient } from "../client";

interface SupabaseTrade {
  id: number;
  user_id: string;
  account_id: string;
  ticket_id: string | null;
  symbol: string;
  direction: string;
  order_type: string;
  open_time: string;
  close_time: string | null;
  open_price: number;
  close_price: number | null;
  entry_price: number | null;
  volume: number;
  lots: number | null;
  commission: number | null;
  swap: number | null;
  fee: number | null;
  gross_profit: number | null;
  net_profit: number | null;
  percent_gain: number | null;
  take_profit: number | null;
  stop_loss: number | null;
  placed_by: string | null;
  outcome: string | null;
  rating: number | null;
  mindset: string | null;
  comment: string | null;
  created_at: string;
  updated_at: string;
  synced_at: string | null;
  version: number | null;
}

function toDomain(row: SupabaseTrade): Trade {
  return {
    id: row.id,
    accountId: row.account_id,
    ticketId: row.ticket_id ?? undefined,
    symbol: row.symbol,
    direction: row.direction as Trade["direction"],
    orderType: row.order_type as Trade["orderType"],
    openTime: new Date(row.open_time),
    closeTime: row.close_time ? new Date(row.close_time) : null,
    openPrice: Number(row.open_price),
    closePrice: row.close_price != null ? Number(row.close_price) : null,
    entryPrice: row.entry_price != null ? Number(row.entry_price) : null,
    volume: Number(row.volume),
    lots: row.lots != null ? Number(row.lots) : undefined,
    commission: row.commission != null ? Number(row.commission) : undefined,
    swap: row.swap != null ? Number(row.swap) : undefined,
    fee: row.fee != null ? Number(row.fee) : undefined,
    grossProfit: row.gross_profit != null ? Number(row.gross_profit) : undefined,
    netProfit: row.net_profit != null ? Number(row.net_profit) : undefined,
    percentGain: row.percent_gain != null ? Number(row.percent_gain) : undefined,
    takeProfit: row.take_profit != null ? Number(row.take_profit) : null,
    stopLoss: row.stop_loss != null ? Number(row.stop_loss) : null,
    placedBy: row.placed_by as Trade["placedBy"],
    outcome: row.outcome as Trade["outcome"],
    rating: row.rating ?? undefined,
    mindset: row.mindset as Trade["mindset"],
    comment: row.comment ?? null,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    syncedAt: row.synced_at ? new Date(row.synced_at) : null,
    version: row.version ?? undefined,
  };
}

function toSupabase(t: Trade, userId: string): Record<string, unknown> {
  return {
    user_id: userId,
    account_id: t.accountId,
    ticket_id: t.ticketId ?? null,
    symbol: t.symbol,
    direction: t.direction,
    order_type: t.orderType,
    open_time: t.openTime instanceof Date ? t.openTime.toISOString() : new Date(t.openTime).toISOString(),
    close_time: t.closeTime ? (t.closeTime instanceof Date ? t.closeTime.toISOString() : new Date(t.closeTime).toISOString()) : null,
    open_price: t.openPrice,
    close_price: t.closePrice ?? null,
    entry_price: t.entryPrice ?? null,
    volume: t.volume,
    lots: t.lots ?? null,
    commission: t.commission ?? null,
    swap: t.swap ?? null,
    fee: t.fee ?? null,
    gross_profit: t.grossProfit ?? null,
    net_profit: t.netProfit ?? null,
    percent_gain: t.percentGain ?? null,
    take_profit: t.takeProfit ?? null,
    stop_loss: t.stopLoss ?? null,
    placed_by: t.placedBy ?? null,
    outcome: t.outcome ?? null,
    rating: t.rating ?? null,
    mindset: t.mindset ?? null,
    comment: t.comment ?? null,
    created_at: t.createdAt instanceof Date ? t.createdAt.toISOString() : new Date(t.createdAt).toISOString(),
    updated_at: t.updatedAt instanceof Date ? t.updatedAt.toISOString() : new Date(t.updatedAt).toISOString(),
    synced_at: t.syncedAt ? (t.syncedAt instanceof Date ? t.syncedAt.toISOString() : new Date(t.syncedAt).toISOString()) : null,
    version: t.version ?? 1,
  };
}

export class SupabaseTradeRepository implements ITradeRepository {
  constructor(private readonly userId: string) {}

  async getById(id: number): Promise<Trade | null> {
    const { data, error } = await getSupabaseClient()
      .from("trades")
      .select("*")
      .eq("user_id", this.userId)
      .eq("id", id)
      .single();

    if (error || !data) return null;
    return toDomain(data as SupabaseTrade);
  }

  async list(query?: TradeQuery): Promise<Trade[]> {
    let q = getSupabaseClient()
      .from("trades")
      .select("*")
      .eq("user_id", this.userId)
      .order("open_time", { ascending: true });

    if (query?.accountId) {
      q = q.eq("account_id", query.accountId);
    }
    if (query?.symbol) {
      q = q.eq("symbol", query.symbol);
    }
    if (query?.direction) {
      q = q.eq("direction", query.direction);
    }
    if (query?.from) {
      q = q.gte("open_time", query.from.toISOString());
    }
    if (query?.to) {
      q = q.lte("open_time", query.to.toISOString());
    }

    const { data, error } = await q;
    if (error) throw new Error(`Failed to fetch trades: ${error.message}`);
    const trades = (data ?? []).map((r) => toDomain(r as SupabaseTrade));

    // Client-side filters for complex query params
    let results = trades;
    if (query?.symbols && query.symbols.length > 0) {
      const set = new Set(query.symbols);
      results = results.filter((t) => set.has(t.symbol));
    }
    if (query?.outcome) {
      results = results.filter((t) => t.outcome === query.outcome);
    }
    if (query?.tagIds?.length) {
      // Would need join - for now skip
    }
    if (query?.ratingMin != null) {
      results = results.filter((t) => (t.rating ?? 0) >= query.ratingMin!);
    }
    if (query?.ratingMax != null) {
      results = results.filter((t) => (t.rating ?? 0) <= query.ratingMax!);
    }
    if (query?.winsOnly) {
      results = results.filter((t) => t.closeTime && (t.netProfit ?? t.grossProfit ?? 0) > 0);
    }
    if (query?.lossesOnly) {
      results = results.filter((t) => t.closeTime && (t.netProfit ?? t.grossProfit ?? 0) < 0);
    }
    if (query?.ids?.length) {
      const idSet = new Set(query.ids);
      results = results.filter((t) => t.id != null && idSet.has(t.id));
    }
    return results;
  }

  async getByAccountId(accountId: string): Promise<Trade[]> {
    const { data, error } = await getSupabaseClient()
      .from("trades")
      .select("*")
      .eq("user_id", this.userId)
      .eq("account_id", accountId)
      .order("open_time", { ascending: true });

    if (error) throw new Error(`Failed to fetch trades: ${error.message}`);
    return (data ?? []).map((r) => toDomain(r as SupabaseTrade));
  }

  async create(trade: Trade): Promise<Trade> {
    const row = toSupabase(trade, this.userId);
    const { data, error } = await getSupabaseClient()
      .from("trades")
      .insert(row)
      .select("id")
      .single();

    if (error) throw new Error(`Failed to create trade: ${error.message}`);
    return { ...trade, id: (data as { id: number }).id };
  }

  async update(id: number, updates: Partial<Trade>): Promise<Trade> {
    const supabaseUpdates: Record<string, unknown> = {};
    if (updates.closeTime !== undefined) supabaseUpdates.close_time = updates.closeTime ? new Date(updates.closeTime).toISOString() : null;
    if (updates.closePrice !== undefined) supabaseUpdates.close_price = updates.closePrice;
    if (updates.rating !== undefined) supabaseUpdates.rating = updates.rating;
    if (updates.mindset !== undefined) supabaseUpdates.mindset = updates.mindset;
    if (updates.comment !== undefined) supabaseUpdates.comment = updates.comment;
    if (Object.keys(supabaseUpdates).length === 0) {
      const existing = await this.getById(id);
      if (!existing) throw new Error(`Trade not found: ${id}`);
      return existing;
    }
    supabaseUpdates.updated_at = new Date().toISOString();

    const { error } = await getSupabaseClient()
      .from("trades")
      .update(supabaseUpdates)
      .eq("user_id", this.userId)
      .eq("id", id);

    if (error) throw new Error(`Failed to update trade: ${error.message}`);
    const updated = await this.getById(id);
    if (!updated) throw new Error(`Trade not found: ${id}`);
    return updated;
  }

  async delete(id: number): Promise<void> {
    const { error } = await getSupabaseClient()
      .from("trades")
      .delete()
      .eq("user_id", this.userId)
      .eq("id", id);

    if (error) throw new Error(`Failed to delete trade: ${error.message}`);
  }

  async bulkUpsert(trades: Trade[]): Promise<void> {
    if (trades.length === 0) return;

    const BATCH = 500;
    for (let i = 0; i < trades.length; i += BATCH) {
      const batch = trades.slice(i, i + BATCH).map((t) => toSupabase(t, this.userId));
      const { error } = await getSupabaseClient()
        .from("trades")
        .upsert(batch, { onConflict: "user_id,account_id,ticket_id", ignoreDuplicates: false });

      if (error) throw new Error(`Failed to upsert trades: ${error.message}`);
    }
  }

  /** List all trades for sync (used by FullSyncService) */
  async listAll(): Promise<Trade[]> {
    const { data, error } = await getSupabaseClient()
      .from("trades")
      .select("*")
      .eq("user_id", this.userId)
      .order("open_time", { ascending: true });

    if (error) throw new Error(`Failed to list trades: ${error.message}`);
    return (data ?? []).map((r) => toDomain(r as SupabaseTrade));
  }

  /** Get trade by account + ticket for ID resolution (used by Dual repos) */
  async getByAccountAndTicket(accountId: string, ticketId: string): Promise<Trade | null> {
    const { data, error } = await getSupabaseClient()
      .from("trades")
      .select("*")
      .eq("user_id", this.userId)
      .eq("account_id", accountId)
      .eq("ticket_id", ticketId)
      .maybeSingle();

    if (error) return null;
    return data ? toDomain(data as SupabaseTrade) : null;
  }

  /** Delete by account + ticket (used when Dexie id differs from Supabase) */
  async deleteByAccountAndTicket(accountId: string, ticketId: string): Promise<void> {
    const { error } = await getSupabaseClient()
      .from("trades")
      .delete()
      .eq("user_id", this.userId)
      .eq("account_id", accountId)
      .eq("ticket_id", ticketId);

    if (error) throw new Error(`Failed to delete trade: ${error.message}`);
  }
}
