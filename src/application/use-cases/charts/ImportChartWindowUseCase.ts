import type { IChartBarRepository } from "@application/ports/repositories";
import type { ICTraderAPI } from "@application/ports/services";
import type { ChartBar, ChartTimeframe, Trade } from "@domain/entities";

export interface ImportChartWindowParams {
  accessToken: string;
  trade: Trade;
  timeframe: ChartTimeframe;
  windowDays?: number;
}

export class ImportChartWindowUseCase {
  constructor(
    private readonly api: ICTraderAPI,
    private readonly chartBarRepository: IChartBarRepository
  ) {}

  async execute(params: ImportChartWindowParams): Promise<ChartBar[]> {
    const windowDays = params.windowDays ?? 2;
    const open = params.trade.openTime.getTime();
    const close = params.trade.closeTime?.getTime() ?? open;
    const from = open - windowDays * 24 * 60 * 60 * 1000;
    const to = close + windowDays * 24 * 60 * 60 * 1000;

    const bars = await this.api.getBars(
      params.accessToken,
      params.trade.symbol,
      params.timeframe,
      from,
      to
    );

    const mapped = bars.map((bar) => ({
      symbol: bar.symbol,
      timeframe: bar.timeframe,
      timestamp: bar.timestamp,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume,
    }));

    await this.chartBarRepository.upsertMany(mapped);
    return mapped;
  }
}
