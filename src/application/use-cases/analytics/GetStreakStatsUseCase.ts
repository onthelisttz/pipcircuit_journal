import type { ITradeRepository, TradeQuery } from "@application/ports/repositories";
import type { Trade } from "@domain/entities";

export interface StreakStats {
  currentStreak: number;
  maxWinStreak: number;
  maxLossStreak: number;
  maxWinStreakProfit: number;
  maxLossStreakProfit: number;
  isWinStreak: boolean;
  /** Trade IDs in the max win streak (chronological order) */
  maxWinStreakTradeIds: number[];
  /** Trade IDs in the max loss streak (chronological order) */
  maxLossStreakTradeIds: number[];
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
        maxWinStreakTradeIds: [],
        maxLossStreakTradeIds: [],
      };
    }

    let winCount = 0;
    let lossCount = 0;
    let winSum = 0;
    let lossSum = 0;
    let winStart = 0;
    let lossStart = 0;
    let bestWinStart = 0;
    let bestLossStart = 0;

    for (let i = 0; i < outcomes.length; i++) {
      if (outcomes[i]) {
        winCount++;
        winSum += profits[i];
        if (lossCount > 0) lossStart = i;
        lossCount = 0;
        lossSum = 0;
        if (winCount === 1) winStart = i;
        if (winCount > maxWinStreak) {
          maxWinStreak = winCount;
          maxWinStreakProfit = winSum;
          bestWinStart = winStart;
        } else if (winCount === maxWinStreak) {
          if (winSum > maxWinStreakProfit) {
            maxWinStreakProfit = winSum;
            bestWinStart = winStart;
          }
        }
      } else {
        lossCount++;
        lossSum += profits[i];
        if (winCount > 0) winStart = i;
        winCount = 0;
        winSum = 0;
        if (lossCount === 1) lossStart = i;
        if (lossCount > maxLossStreak) {
          maxLossStreak = lossCount;
          maxLossStreakProfit = lossSum;
          bestLossStart = lossStart;
        } else if (lossCount === maxLossStreak) {
          if (lossSum < maxLossStreakProfit) {
            maxLossStreakProfit = lossSum;
            bestLossStart = lossStart;
          }
        }
      }
    }

    isWinStreak = outcomes[outcomes.length - 1] ?? true;
    currentStreak = isWinStreak ? winCount : lossCount;

    const maxWinStreakTradeIds = closed
      .slice(bestWinStart, bestWinStart + maxWinStreak)
      .map((t) => (t as Trade).id)
      .filter((id): id is number => id != null);
    const maxLossStreakTradeIds = closed
      .slice(bestLossStart, bestLossStart + maxLossStreak)
      .map((t) => (t as Trade).id)
      .filter((id): id is number => id != null);

    return {
      currentStreak,
      maxWinStreak,
      maxLossStreak,
      maxWinStreakProfit,
      maxLossStreakProfit,
      isWinStreak,
      maxWinStreakTradeIds,
      maxLossStreakTradeIds,
    };
  }
}
