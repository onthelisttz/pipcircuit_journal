import type { ITradeRepository, TradeQuery } from "@application/ports/repositories";
import { TradeOutcome } from "@domain/enums";

export interface WinRateResult {
  winRate: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  breakevenTrades: number;
}

export interface CalculateWinRateInput {
  accountId: string;
  query?: Omit<TradeQuery, "accountId">;
}

export class CalculateWinRateUseCase {
  constructor(private readonly tradeRepo: ITradeRepository) {}

  async execute(input: CalculateWinRateInput): Promise<WinRateResult> {
    const trades = await this.tradeRepo.list({
      ...input.query,
      accountId: input.accountId,
    });

    // Treat any trade with a closeTime as closed; missing P&L is treated as 0.
    const closed = trades.filter((t) => t.closeTime);
    const winning = closed.filter((t) => (t.netProfit ?? t.grossProfit ?? 0) > 0);
    const losing = closed.filter((t) => (t.netProfit ?? t.grossProfit ?? 0) < 0);
    const breakeven = closed.filter((t) => (t.netProfit ?? t.grossProfit ?? 0) === 0);

    const total = closed.length;
    const winRate = total > 0 ? (winning.length / total) * 100 : 0;

    return {
      winRate,
      totalTrades: total,
      winningTrades: winning.length,
      losingTrades: losing.length,
      breakevenTrades: breakeven.length,
    };
  }
}
