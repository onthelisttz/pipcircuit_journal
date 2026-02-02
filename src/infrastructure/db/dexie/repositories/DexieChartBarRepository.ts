import type { IChartBarRepository } from "@application/ports/repositories";
import type { ChartBar, ChartTimeframe } from "@domain/entities";
import { db } from "../database";

export class DexieChartBarRepository implements IChartBarRepository {
  async getByWindow(
    symbol: string,
    timeframe: ChartTimeframe,
    from: number,
    to: number
  ): Promise<ChartBar[]> {
    return db.chart_bars
      .where("[symbol+timeframe+timestamp]")
      .between([symbol, timeframe, from], [symbol, timeframe, to], true, true)
      .toArray();
  }

  async upsertMany(bars: ChartBar[]): Promise<void> {
    await db.chart_bars.bulkPut(bars);
  }

  async deleteByWindow(
    symbol: string,
    timeframe: ChartTimeframe,
    from: number,
    to: number
  ): Promise<void> {
    await db.chart_bars
      .where("[symbol+timeframe+timestamp]")
      .between([symbol, timeframe, from], [symbol, timeframe, to], true, true)
      .delete();
  }
}
