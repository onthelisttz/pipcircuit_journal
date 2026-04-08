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
    
    
    
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      
      await db.chart_bars.bulkPut(batch);
      
    }
    
    
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
      const brokerQuery = () =>
        db.chart_bars
          .where("[broker+symbol+timeframe+timestamp]")
          .between(
            [broker, symbol, timeframe, 0],
            [broker, symbol, timeframe, Number.MAX_SAFE_INTEGER],
            true,
            true
          );

      const [firstBar, lastBar] = await Promise.all([
        brokerQuery().first(),
        brokerQuery().last(),
      ]);

      if (!firstBar || !lastBar) {
        // Try fallback query without broker filter (for backward compatibility)
        const fallbackQuery = () =>
          db.chart_bars
            .where("[symbol+timeframe+timestamp]")
            .between(
              [symbol, timeframe, 0],
              [symbol, timeframe, Number.MAX_SAFE_INTEGER],
              true,
              true
            )
            .filter((bar) => bar.broker === broker);

        const [fallbackFirstBar, fallbackLastBar] = await Promise.all([
          fallbackQuery().first(),
          fallbackQuery().last(),
        ]);

        if (!fallbackFirstBar || !fallbackLastBar) {
          return { firstBarDate: null, lastBarDate: null };
        }

        return {
          firstBarDate: new Date(fallbackFirstBar.timestamp),
          lastBarDate: new Date(fallbackLastBar.timestamp),
        };
      }

      return {
        firstBarDate: new Date(firstBar.timestamp),
        lastBarDate: new Date(lastBar.timestamp),
      };
    } catch (error) {
      console.error(`[DexieChartRepo] Error getting date range for ${broker}:${symbol}:`, error);
      return { firstBarDate: null, lastBarDate: null };
    }
  }
}
