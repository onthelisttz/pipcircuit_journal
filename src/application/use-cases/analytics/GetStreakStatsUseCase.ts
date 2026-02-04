import type { ITradeRepository, TradeQuery } from "@application/ports/repositories";

export interface StreakStats {
  currentStreak: number;
  maxWinStreak: number;
  maxLossStreak: number;
  maxWinStreakProfit: number;
  maxLossStreakProfit: number;
  isWinStreak: boolean;
}

export interface GetStreakStatsInput {
  accountId: string;
  query?: Omit<TradeQuery, "accountId">;
}

export class GetStreakStatsUseCase {
  constructor(private readonly tradeRepo: ITradeRepository) {}

  async execute(input: GetStreakStatsInput): Promise<StreakStats> {
    const trades = await this.tradeRepo.list({
      ...input.query,
      accountId: input.accountId,
    });

    const sorted = [...trades].sort(
      (a, b) => a.openTime.getTime() - b.openTime.getTime()
    );

    // Use all trades with a closeTime for streaks; treat missing P&L as 0.
    const closed = sorted.filter((t) => t.closeTime);
    const profits = closed.map((t) => t.netProfit ?? t.grossProfit ?? 0);
    const outcomes = profits.map((p) => p > 0);

    let currentStreak = 0;
    let maxWinStreak = 0;
    let maxLossStreak = 0;
    let maxWinStreakProfit = 0;
    let maxLossStreakProfit = 0;
    let isWinStreak = true;

    if (outcomes.length === 0) {
      return {
        currentStreak: 0,
        maxWinStreak: 0,
        maxLossStreak: 0,
        maxWinStreakProfit: 0,
        maxLossStreakProfit: 0,
        isWinStreak: true,
      };
    }

    let winCount = 0;
    let lossCount = 0;
    let winSum = 0;
    let lossSum = 0;

    for (let i = 0; i < outcomes.length; i++) {
      if (outcomes[i]) {
        winCount++;
        winSum += profits[i];
        lossCount = 0;
        lossSum = 0;
        if (winCount > maxWinStreak) {
          maxWinStreak = winCount;
          maxWinStreakProfit = winSum;
        } else if (winCount === maxWinStreak) {
          maxWinStreakProfit = Math.max(maxWinStreakProfit, winSum);
        }
      } else {
        lossCount++;
        lossSum += profits[i];
        winCount = 0;
        winSum = 0;
        if (lossCount > maxLossStreak) {
          maxLossStreak = lossCount;
          maxLossStreakProfit = lossSum;
        } else if (lossCount === maxLossStreak) {
          maxLossStreakProfit = Math.min(maxLossStreakProfit, lossSum);
        }
      }
    }

    isWinStreak = outcomes[outcomes.length - 1] ?? true;
    currentStreak = isWinStreak ? winCount : lossCount;

    return {
      currentStreak,
      maxWinStreak,
      maxLossStreak,
      maxWinStreakProfit,
      maxLossStreakProfit,
      isWinStreak,
    };
  }
}
