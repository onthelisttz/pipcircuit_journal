import type { ChartBar, ChartTimeframe } from "@domain/entities";

export interface IChartBarRepository {
  getByWindow(
    symbol: string,
    timeframe: ChartTimeframe,
    from: number,
    to: number,
    broker?: string
  ): Promise<ChartBar[]>;
  upsertMany(bars: ChartBar[]): Promise<void>;
  deleteByWindow(
    symbol: string,
    timeframe: ChartTimeframe,
    from: number,
    to: number,
    broker?: string
  ): Promise<void>;
  /**
   * Get bars by broker and symbol (broker-based query)
   */
  getByBrokerAndSymbol(
    broker: string,
    symbol: string,
    timeframe: ChartTimeframe,
    from: number,
    to: number
  ): Promise<ChartBar[]>;
  /**
   * Count total bars for a broker+symbol+timeframe (optional for repos that support it).
   */
  countBars?(
    broker: string,
    symbol: string,
    timeframe?: ChartTimeframe
  ): Promise<number>;
  /**
   * Get date range for a broker+symbol+timeframe (optional for repos that support it).
   */
  getDateRange?(
    broker: string,
    symbol: string,
    timeframe?: ChartTimeframe
  ): Promise<{ firstBarDate: Date | null; lastBarDate: Date | null }>;
}
