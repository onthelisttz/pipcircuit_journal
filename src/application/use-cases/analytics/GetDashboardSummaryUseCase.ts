import type { ITradeRepository, TradeQuery } from "@application/ports/repositories";
import { CalculateDrawdownUseCase } from "./CalculateDrawdownUseCase";
import { CalculateWinRateUseCase } from "./CalculateWinRateUseCase";

export interface DashboardSummary {
  netProfit: number;
  totalTrades: number;
  winRate: number;
  maxDrawdown: number;
  breakevenTrades: number;
  totalDeposits: number;
  percentFromPeak: number;
}

export interface GetDashboardSummaryInput {
  accountId: string;
  query?: Omit<TradeQuery, "accountId">;
}

export class GetDashboardSummaryUseCase {
  constructor(private readonly tradeRepo: ITradeRepository) {}

  async execute(input: GetDashboardSummaryInput): Promise<DashboardSummary> {
    const [winRateResult, drawdownPoints] = await Promise.all([
      new CalculateWinRateUseCase(this.tradeRepo).execute(input),
      new CalculateDrawdownUseCase(this.tradeRepo).execute(input),
    ]);

    const trades = await this.tradeRepo.list({
      ...input.query,
      accountId: input.accountId,
    });

    // Closed = has a closeTime; missing P&L counts as 0.
    const closed = trades.filter((t) => t.closeTime);
    const netProfit = closed.reduce((a, t) => a + (t.netProfit ?? t.grossProfit ?? 0), 0);

    const maxDrawdown = drawdownPoints.length > 0
      ? Math.max(...drawdownPoints.map((p) => p.drawdown))
      : 0;

    const peak = drawdownPoints.length > 0
      ? Math.max(...drawdownPoints.map((p) => p.equity))
      : 0;
    const percentFromPeak = peak > 0 ? ((peak - maxDrawdown) / peak) * 100 : 100;

    return {
      netProfit,
      totalTrades: winRateResult.totalTrades,
      winRate: winRateResult.winRate,
      maxDrawdown,
      breakevenTrades: winRateResult.breakevenTrades,
      totalDeposits: 0,
      percentFromPeak,
    };
  }
}
