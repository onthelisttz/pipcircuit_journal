import type { ISymbolSyncProgressRepository } from "@application/ports/repositories";
import type { SymbolSyncProgress, SymbolSyncStatus } from "@domain/entities";
import { getSupabaseClient } from "../client";

interface SupabaseSymbolSyncProgress {
  id: number;
  user_id: string;
  broker: string;
  symbol: string;
  first_bar_date: string | null;
  last_bar_date: string | null;
  last_sync_time: string | null;
  total_bars: number;
  status: string;
  error: string | null;
  progress_percent: number | null;
}

function toDomainProgress(row: SupabaseSymbolSyncProgress): SymbolSyncProgress {
  return {
    id: row.id,
    broker: row.broker,
    symbol: row.symbol,
    firstBarDate: row.first_bar_date ? new Date(row.first_bar_date) : null,
    lastBarDate: row.last_bar_date ? new Date(row.last_bar_date) : null,
    lastSyncTime: row.last_sync_time ? new Date(row.last_sync_time) : null,
    totalBars: row.total_bars,
    status: row.status as SymbolSyncStatus,
    error: row.error,
    progressPercent: row.progress_percent ?? undefined,
  };
}

function toSupabaseProgress(
  progress: SymbolSyncProgress,
  userId: string
): Omit<SupabaseSymbolSyncProgress, "id"> {
  return {
    user_id: userId,
    broker: progress.broker,
    symbol: progress.symbol,
    first_bar_date: progress.firstBarDate?.toISOString() || null,
    last_bar_date: progress.lastBarDate?.toISOString() || null,
    last_sync_time: progress.lastSyncTime?.toISOString() || null,
    total_bars: progress.totalBars,
    status: progress.status,
    error: progress.error || null,
    progress_percent: progress.progressPercent ?? null,
  };
}

export class SupabaseSymbolSyncProgressRepository implements ISymbolSyncProgressRepository {
  constructor(private readonly userId: string) {}

  async getByBrokerAndSymbol(
    broker: string,
    symbol: string
  ): Promise<SymbolSyncProgress | null> {
    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from("symbol_sync_progress")
      .select("*")
      .eq("user_id", this.userId)
      .eq("broker", broker)
      .eq("symbol", symbol)
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        // Not found
        return null;
      }
      throw new Error(`Failed to fetch sync progress: ${error.message}`);
    }

    return data ? toDomainProgress(data as SupabaseSymbolSyncProgress) : null;
  }

  async getByBroker(broker: string): Promise<SymbolSyncProgress[]> {
    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from("symbol_sync_progress")
      .select("*")
      .eq("user_id", this.userId)
      .eq("broker", broker)
      .order("symbol", { ascending: true });

    if (error) {
      throw new Error(`Failed to fetch sync progress: ${error.message}`);
    }

    return (data as SupabaseSymbolSyncProgress[]).map(toDomainProgress);
  }

  async getAll(): Promise<SymbolSyncProgress[]> {
    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from("symbol_sync_progress")
      .select("*")
      .eq("user_id", this.userId)
      .order("broker", { ascending: true })
      .order("symbol", { ascending: true });

    if (error) {
      throw new Error(`Failed to fetch sync progress: ${error.message}`);
    }

    return (data as SupabaseSymbolSyncProgress[]).map(toDomainProgress);
  }

  async getByStatus(status: SymbolSyncStatus): Promise<SymbolSyncProgress[]> {
    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from("symbol_sync_progress")
      .select("*")
      .eq("user_id", this.userId)
      .eq("status", status)
      .order("broker", { ascending: true })
      .order("symbol", { ascending: true });

    if (error) {
      throw new Error(`Failed to fetch sync progress: ${error.message}`);
    }

    return (data as SupabaseSymbolSyncProgress[]).map(toDomainProgress);
  }

  async upsert(progress: SymbolSyncProgress): Promise<void> {
    const supabase = getSupabaseClient();
    const supabaseProgress = toSupabaseProgress(progress, this.userId);

    const { error } = await supabase
      .from("symbol_sync_progress")
      .upsert(supabaseProgress, {
        onConflict: "user_id,broker,symbol",
        ignoreDuplicates: false,
      });

    if (error) {
      throw new Error(`Failed to upsert sync progress: ${error.message}`);
    }
  }

  async updateStatus(
    broker: string,
    symbol: string,
    status: SymbolSyncStatus,
    error?: string | null
  ): Promise<void> {
    const supabase = getSupabaseClient();

    const updates: Partial<SupabaseSymbolSyncProgress> = {
      status,
      error: error ?? null,
    };

    if (status === "completed" || status === "failed") {
      updates.last_sync_time = new Date().toISOString();
    }

    const { error: updateError } = await supabase
      .from("symbol_sync_progress")
      .update(updates)
      .eq("user_id", this.userId)
      .eq("broker", broker)
      .eq("symbol", symbol);

    if (updateError) {
      throw new Error(`Failed to update sync status: ${updateError.message}`);
    }
  }

  async updateProgress(
    broker: string,
    symbol: string,
    updates: Partial<SymbolSyncProgress>
  ): Promise<void> {
    const supabase = getSupabaseClient();

    const supabaseUpdates: Partial<SupabaseSymbolSyncProgress> = {};

    if (updates.firstBarDate !== undefined) {
      supabaseUpdates.first_bar_date = updates.firstBarDate?.toISOString() || null;
    }
    if (updates.lastBarDate !== undefined) {
      supabaseUpdates.last_bar_date = updates.lastBarDate?.toISOString() || null;
    }
    if (updates.lastSyncTime !== undefined) {
      supabaseUpdates.last_sync_time = updates.lastSyncTime?.toISOString() || null;
    }
    if (updates.totalBars !== undefined) {
      supabaseUpdates.total_bars = updates.totalBars;
    }
    if (updates.status !== undefined) {
      supabaseUpdates.status = updates.status;
    }
    if (updates.error !== undefined) {
      supabaseUpdates.error = updates.error || null;
    }
    if (updates.progressPercent !== undefined) {
      supabaseUpdates.progress_percent = updates.progressPercent ?? null;
    }

    const { error } = await supabase
      .from("symbol_sync_progress")
      .upsert(
        {
          user_id: this.userId,
          broker,
          symbol,
          first_bar_date: null,
          last_bar_date: null,
          last_sync_time: null,
          total_bars: 0,
          status: "pending",
          error: null,
          progress_percent: null,
          ...supabaseUpdates,
        },
        {
          onConflict: "user_id,broker,symbol",
          ignoreDuplicates: false,
        }
      );

    if (error) {
      throw new Error(`Failed to update sync progress: ${error.message}`);
    }
  }

  async delete(broker: string, symbol: string): Promise<void> {
    const supabase = getSupabaseClient();

    const { error } = await supabase
      .from("symbol_sync_progress")
      .delete()
      .eq("user_id", this.userId)
      .eq("broker", broker)
      .eq("symbol", symbol);

    if (error) {
      throw new Error(`Failed to delete sync progress: ${error.message}`);
    }
  }

  async deleteByBroker(broker: string): Promise<void> {
    const supabase = getSupabaseClient();

    const { error } = await supabase
      .from("symbol_sync_progress")
      .delete()
      .eq("user_id", this.userId)
      .eq("broker", broker);

    if (error) {
      throw new Error(`Failed to delete sync progress: ${error.message}`);
    }
  }
}
