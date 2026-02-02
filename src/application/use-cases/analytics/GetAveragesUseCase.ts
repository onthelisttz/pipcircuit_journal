import type { ITradeRepository, TradeQuery } from "@application/ports/repositories";

export interface AveragesResult {
  avgProfitPerTrade: number;
  avgWin: number;
  avgLoss: number;
  avgTradeDurationMinutes: number;
  avgRMultiple: number;
}

export interface GetAveragesInput {
  accountId: string;
  query?: Omit<TradeQuery, "accountId">;
}

export class GetAveragesUseCase {
  constructor(private readonly tradeRepo: ITradeRepository) {}

  async execute(input: GetAveragesInput): Promise<AveragesResult> {
    const trades = await this.tradeRepo.list({
      ...input.query,
      accountId: input.accountId,
    });

    const closed = trades.filter((t) => t.closeTime && (t.netProfit ?? t.grossProfit) !== undefined);
    const profits = closed.map((t) => t.netProfit ?? t.grossProfit ?? 0);
    const wins = profits.filter((p) => p > 0);
    const losses = profits.filter((p) => p < 0);

    const totalProfit = profits.reduce((a, b) => a + b, 0);
    const avgProfitPerTrade = closed.length > 0 ? totalProfit / closed.length : 0;
    const avgWin = wins.length > 0 ? wins.reduce((a, b) => a + b, 0) / wins.length : 0;
    const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((a, b) => a + b, 0)) / losses.length : 0;

    const durations = closed
      .filter((t) => t.closeTime)
      .map((t) => (t.closeTime!.getTime() - t.openTime.getTime()) / (1000 * 60));
    const avgTradeDurationMinutes =
      durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;

    const avgLossAbs = avgLoss > 0 ? avgLoss : 1;
    const avgRMultiple = avgProfitPerTrade / avgLossAbs;

    return {
      avgProfitPerTrade,
      avgWin,
      avgLoss,
      avgTradeDurationMinutes,
      avgRMultiple,
    };
  }
}
