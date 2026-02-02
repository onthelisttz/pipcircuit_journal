import type { ITradeRepository, TradeQuery } from "@application/ports/repositories";

export interface RiskMetrics {
  profitFactor: number;
  sharpeRatio: number;
  sortinoRatio: number;
  zScore: number;
  avgWin: number;
  avgLoss: number;
  grossProfit: number;
  grossLoss: number;
}

export interface CalculateRiskMetricsInput {
  accountId: string;
  query?: Omit<TradeQuery, "accountId">;
  riskFreeRate?: number;
}

export class CalculateRiskMetricsUseCase {
  constructor(private readonly tradeRepo: ITradeRepository) {}

  async execute(input: CalculateRiskMetricsInput): Promise<RiskMetrics> {
    const trades = await this.tradeRepo.list({
      ...input.query,
      accountId: input.accountId,
    });

    const closed = trades.filter((t) => t.closeTime && (t.netProfit ?? t.grossProfit) !== undefined);
    const profits = closed.map((t) => t.netProfit ?? t.grossProfit ?? 0);

    const wins = profits.filter((p) => p > 0);
    const losses = profits.filter((p) => p < 0);

    const grossProfit = wins.reduce((a, b) => a + b, 0);
    const grossLoss = Math.abs(losses.reduce((a, b) => a + b, 0));

    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

    const avgWin = wins.length > 0 ? grossProfit / wins.length : 0;
    const avgLoss = losses.length > 0 ? grossLoss / losses.length : 0;

    const mean = profits.length > 0 ? profits.reduce((a, b) => a + b, 0) / profits.length : 0;
    const variance =
      profits.length > 1
        ? profits.reduce((a, p) => a + (p - mean) ** 2, 0) / (profits.length - 1)
        : 0;
    const stdDev = Math.sqrt(variance);

    const riskFree = input.riskFreeRate ?? 0;
    const excessReturn = mean - riskFree;
    const sharpeRatio = stdDev > 0 ? excessReturn / stdDev : 0;

    const downsideReturns = profits.filter((p) => p < 0);
    const downsideVariance =
      downsideReturns.length > 1
        ? downsideReturns.reduce((a, p) => a + (p - mean) ** 2, 0) / downsideReturns.length
        : 0;
    const downsideDev = Math.sqrt(downsideVariance);
    const sortinoRatio = downsideDev > 0 ? excessReturn / downsideDev : sharpeRatio;

    const winsCount = wins.length;
    const lossesCount = losses.length;
    const n = winsCount + lossesCount;
    const p = n > 0 ? winsCount / n : 0.5;
    const expectedStreak = n * p * (1 - p);
    const zScore = expectedStreak > 0 ? (winsCount - n * p) / Math.sqrt(expectedStreak) : 0;

    return {
      profitFactor,
      sharpeRatio,
      sortinoRatio,
      zScore,
      avgWin,
      avgLoss,
      grossProfit,
      grossLoss,
    };
  }
}
