import type { IChartBarRepository } from "@application/ports/repositories";
import type { ChartBar, ChartTimeframe } from "@domain/entities";
import { getSupabaseClient } from "../client";

interface SupabaseChartBar {
  id: number;
  user_id: string;
  broker: string;
  symbol: string;
  timeframe: string;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  synced_at: string | null;
  version: number;
}

function toDomainBar(row: SupabaseChartBar): ChartBar {
  return {
    id: row.id,
    broker: row.broker,
    symbol: row.symbol,
    timeframe: row.timeframe as ChartTimeframe,
    timestamp: row.timestamp,
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    volume: Number(row.volume),
    syncedAt: row.synced_at ? new Date(row.synced_at) : null,
  };
}

function toSupabaseBar(bar: ChartBar, userId: string): Omit<SupabaseChartBar, "id" | "version"> {
  return {
    user_id: userId,
    broker: bar.broker || "Unknown",
    symbol: bar.symbol,
    timeframe: bar.timeframe,
    timestamp: bar.timestamp,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
    synced_at: bar.syncedAt?.toISOString() || null,
  };
}

export class SupabaseChartBarRepository implements IChartBarRepository {
  constructor(private readonly userId: string) {}

  async getByWindow(
    symbol: string,
    timeframe: ChartTimeframe,
    from: number,
    to: number,
    broker?: string
  ): Promise<ChartBar[]> {
    const supabase = getSupabaseClient();

    let query = supabase
      .from("chart_bars")
      .select("*")
      .eq("user_id", this.userId)
      .eq("symbol", symbol)
      .eq("timeframe", timeframe)
      .gte("timestamp", from)
      .lte("timestamp", to)
      .order("timestamp", { ascending: true });

    if (broker) {
      query = query.eq("broker", broker);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Failed to fetch chart bars: ${error.message}`);
    }

    return (data as SupabaseChartBar[]).map(toDomainBar);
  }

  async upsertMany(bars: ChartBar[]): Promise<void> {
    if (bars.length === 0) return;

    // Process in batches of 1000 to avoid Supabase payload limits and improve performance
    const BATCH_SIZE = 1000;
    const batches: ChartBar[][] = [];
    
    for (let i = 0; i < bars.length; i += BATCH_SIZE) {
      batches.push(bars.slice(i, i + BATCH_SIZE));
    }
    
    
    
    const supabase = getSupabaseClient();
    
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      const supabaseBars = batch.map((bar) => toSupabaseBar(bar, this.userId));
      
      
      
      // Use upsert with onConflict to handle duplicates
      const { error } = await supabase
        .from("chart_bars")
        .upsert(supabaseBars, {
          onConflict: "user_id,broker,symbol,timeframe,timestamp",
          ignoreDuplicates: false,
        });

      if (error) {
        console.error(`[SupabaseChartRepo] Error syncing batch ${i + 1}/${batches.length}:`, error);
        throw new Error(`Failed to upsert chart bars (batch ${i + 1}/${batches.length}): ${error.message}`);
      }
      
      
    }
    
    
  }

  /**
   * Delete all bars for a broker+symbol (allows starting over)
   */
  async deleteAllForSymbol(
    broker: string,
    symbol: string,
    timeframe: ChartTimeframe = "M1"
  ): Promise<void> {
    const supabase = getSupabaseClient();

    const { error } = await supabase
      .from("chart_bars")
      .delete()
      .eq("user_id", this.userId)
      .eq("broker", broker)
      .eq("symbol", symbol)
      .eq("timeframe", timeframe);

    if (error) {
      throw new Error(`Failed to delete chart bars: ${error.message}`);
    }
  }

  async deleteByWindow(
    symbol: string,
    timeframe: ChartTimeframe,
    from: number,
    to: number,
    broker?: string
  ): Promise<void> {
    const supabase = getSupabaseClient();

    let query = supabase
      .from("chart_bars")
      .delete()
      .eq("user_id", this.userId)
      .eq("symbol", symbol)
      .eq("timeframe", timeframe)
      .gte("timestamp", from)
      .lte("timestamp", to);

    if (broker) {
      query = query.eq("broker", broker);
    }

    const { error } = await query;

    if (error) {
      throw new Error(`Failed to delete chart bars: ${error.message}`);
    }
  }

  async getByBrokerAndSymbol(
    broker: string,
    symbol: string,
    timeframe: ChartTimeframe,
    from: number,
    to: number
  ): Promise<ChartBar[]> {
    return this.getByWindow(symbol, timeframe, from, to, broker);
  }

  /**
   * Count total bars for a symbol
   */
  async countBars(
    broker: string,
    symbol: string,
    timeframe: ChartTimeframe = "M1"
  ): Promise<number> {
    try {
      const supabase = getSupabaseClient();

      const query = supabase
        .from("chart_bars")
        .select("*", { count: "exact", head: true })
        .eq("user_id", this.userId)
        .eq("symbol", symbol)
        .eq("timeframe", timeframe)
        .eq("broker", broker);

      const { count, error } = await query;

      if (error) {
        throw new Error(`Failed to count chart bars: ${error.message}`);
      }

      return count || 0;
    } catch (error) {
      console.error(`[SupabaseChartRepo] Error counting bars for ${broker}:${symbol}:`, error);
      return 0;
    }
  }
}
