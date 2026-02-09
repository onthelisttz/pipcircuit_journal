import type { IChartBarRepository } from "@application/ports/repositories";
import type { ChartBar, ChartTimeframe } from "@domain/entities";
import { db } from "../database";

export class DexieChartBarRepository implements IChartBarRepository {
  async getByWindow(
    symbol: string,
    timeframe: ChartTimeframe,
    from: number,
    to: number,
    broker?: string
  ): Promise<ChartBar[]> {
    // If broker is provided, use broker-based index (new approach)
    if (broker) {
      return db.chart_bars
        .where("[broker+symbol+timeframe+timestamp]")
        .between(
          [broker, symbol, timeframe, from],
          [broker, symbol, timeframe, to],
          true,
          true
        )
        .toArray();
    }

    // Fallback to old index for backward compatibility
    // This will work but may return bars from multiple brokers
    return db.chart_bars
      .where("[symbol+timeframe+timestamp]")
      .between([symbol, timeframe, from], [symbol, timeframe, to], true, true)
      .toArray();
  }

  async upsertMany(bars: ChartBar[]): Promise<void> {
    if (bars.length === 0) return;
    
    // Process in batches of 2000 to avoid IndexedDB performance issues
    const BATCH_SIZE = 2000;
    const batches: ChartBar[][] = [];
    
    for (let i = 0; i < bars.length; i += BATCH_SIZE) {
      batches.push(bars.slice(i, i + BATCH_SIZE));
    }
    
    console.log(`[DexieChartRepo] Processing ${bars.length} bars in ${batches.length} batches of ${BATCH_SIZE}`);
    
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      console.log(`[DexieChartRepo] Storing batch ${i + 1}/${batches.length} (${batch.length} bars)`);
      await db.chart_bars.bulkPut(batch);
      console.log(`[DexieChartRepo] Batch ${i + 1}/${batches.length} stored`);
    }
    
    console.log(`[DexieChartRepo] All ${bars.length} bars stored successfully`);
  }

  async deleteByWindow(
    symbol: string,
    timeframe: ChartTimeframe,
    from: number,
    to: number,
    broker?: string
  ): Promise<void> {
    if (broker) {
      await db.chart_bars
        .where("[broker+symbol+timeframe+timestamp]")
        .between(
          [broker, symbol, timeframe, from],
          [broker, symbol, timeframe, to],
          true,
          true
        )
        .delete();
    } else {
      await db.chart_bars
        .where("[symbol+timeframe+timestamp]")
        .between([symbol, timeframe, from], [symbol, timeframe, to], true, true)
        .delete();
    }
  }

  /**
   * Get bars by broker and symbol (new broker-based query)
   */
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
   * Delete all bars for a broker+symbol (allows starting over)
   */
  async deleteAllForSymbol(
    broker: string,
    symbol: string,
    timeframe: ChartTimeframe = "M1"
  ): Promise<number> {
    const deleted = await db.chart_bars
      .where("[broker+symbol+timeframe+timestamp]")
      .between(
        [broker, symbol, timeframe, 0],
        [broker, symbol, timeframe, Number.MAX_SAFE_INTEGER],
        true,
        true
      )
      .delete();
    return deleted;
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
      const count = await db.chart_bars
        .where("[broker+symbol+timeframe+timestamp]")
        .between(
          [broker, symbol, timeframe, 0],
          [broker, symbol, timeframe, Number.MAX_SAFE_INTEGER],
          true,
          true
        )
        .count();
      return count;
    } catch (error) {
      console.error(`[DexieChartRepo] Error counting bars for ${broker}:${symbol}:`, error);
      return 0;
    }
  }

  /**
   * Get date range (min/max timestamps) for a symbol from existing bars
   */
  async getDateRange(
    broker: string,
    symbol: string,
    timeframe: ChartTimeframe = "M1"
  ): Promise<{ firstBarDate: Date | null; lastBarDate: Date | null }> {
    try {
      // Query all bars for this broker+symbol+timeframe combination
      const bars = await db.chart_bars
        .where("[broker+symbol+timeframe+timestamp]")
        .between(
          [broker, symbol, timeframe, 0],
          [broker, symbol, timeframe, Number.MAX_SAFE_INTEGER],
          true,
          true
        )
        .toArray();

      if (bars.length === 0) {
        // Try fallback query without broker filter (for backward compatibility)
        const fallbackBars = await db.chart_bars
          .where("[symbol+timeframe+timestamp]")
          .between(
            [symbol, timeframe, 0],
            [symbol, timeframe, Number.MAX_SAFE_INTEGER],
            true,
            true
          )
          .filter((bar) => bar.broker === broker)
          .toArray();
        
        if (fallbackBars.length === 0) {
          return { firstBarDate: null, lastBarDate: null };
        }
        
        const timestamps = fallbackBars.map((bar) => bar.timestamp).sort((a, b) => a - b);
        return {
          firstBarDate: new Date(timestamps[0]),
          lastBarDate: new Date(timestamps[timestamps.length - 1]),
        };
      }

      const timestamps = bars.map((bar) => bar.timestamp).sort((a, b) => a - b);
      return {
        firstBarDate: new Date(timestamps[0]),
        lastBarDate: new Date(timestamps[timestamps.length - 1]),
      };
    } catch (error) {
      console.error(`[DexieChartRepo] Error getting date range for ${broker}:${symbol}:`, error);
      return { firstBarDate: null, lastBarDate: null };
    }
  }
}
