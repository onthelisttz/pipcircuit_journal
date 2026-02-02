import type { ChartBar, ChartTimeframe } from "@domain/entities";

export interface IChartBarRepository {
  getByWindow(
    symbol: string,
    timeframe: ChartTimeframe,
    from: number,
    to: number
  ): Promise<ChartBar[]>;
  upsertMany(bars: ChartBar[]): Promise<void>;
  deleteByWindow(
    symbol: string,
    timeframe: ChartTimeframe,
    from: number,
    to: number
  ): Promise<void>;
}
