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
}
