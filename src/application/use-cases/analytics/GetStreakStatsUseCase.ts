import type { ITradeRepository, TradeQuery } from "@application/ports/repositories";

export interface StreakStats {
  currentStreak: number;
  maxWinStreak: number;
  maxLossStreak: number;
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

    const closed = sorted.filter((t) => t.closeTime && (t.netProfit ?? t.grossProfit) !== undefined);
    const outcomes = closed.map((t) => (t.netProfit ?? t.grossProfit ?? 0) > 0);

    let currentStreak = 0;
    let maxWinStreak = 0;
    let maxLossStreak = 0;
    let isWinStreak = true;

    if (outcomes.length === 0) {
      return { currentStreak: 0, maxWinStreak: 0, maxLossStreak: 0, isWinStreak: true };
    }

    let winCount = 0;
    let lossCount = 0;

    for (let i = 0; i < outcomes.length; i++) {
      if (outcomes[i]) {
        winCount++;
        lossCount = 0;
        maxWinStreak = Math.max(maxWinStreak, winCount);
      } else {
        lossCount++;
        winCount = 0;
        maxLossStreak = Math.max(maxLossStreak, lossCount);
      }
    }

    isWinStreak = outcomes[outcomes.length - 1] ?? true;
    currentStreak = isWinStreak ? winCount : lossCount;

    return {
      currentStreak,
      maxWinStreak,
      maxLossStreak,
      isWinStreak,
    };
  }
}
