import type { ITradeRepository, TradeQuery } from "@application/ports/repositories";
import { Session } from "@domain/enums";
import { getSessionFromDate } from "@domain/services/SessionClassifier";

export interface SessionPerformance {
  session: Session;
  count: number;
  profit: number;
  winRate: number;
}

export interface GetPerformanceBySessionInput {
  accountId: string;
  query?: Omit<TradeQuery, "accountId">;
}

export class GetPerformanceBySessionUseCase {
  constructor(private readonly tradeRepo: ITradeRepository) {}

  async execute(input: GetPerformanceBySessionInput): Promise<SessionPerformance[]> {
    const trades = await this.tradeRepo.list({
      ...input.query,
      accountId: input.accountId,
    });

    // Closed trades are identified by closeTime; P&L falls back to 0.
    const closed = trades.filter((t) => t.closeTime);

    const bySession = new Map<Session, { profits: number[] }>();

    for (const s of Object.values(Session)) {
      bySession.set(s as Session, { profits: [] });
    }

    for (const trade of closed) {
      const session = getSessionFromDate(trade.openTime);
      const net = trade.netProfit ?? trade.grossProfit ?? 0;
      const entry = bySession.get(session)!;
      entry.profits.push(net);
    }

    return Array.from(bySession.entries()).map(([session, { profits }]) => {
      const count = profits.length;
      const profit = profits.reduce((a, b) => a + b, 0);
      const wins = profits.filter((p) => p > 0).length;
      const winRate = count > 0 ? (wins / count) * 100 : 0;
      return { session, count, profit, winRate };
    });
  }
}
