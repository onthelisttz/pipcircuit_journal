import type { ITradeRepository, TradeQuery } from "@application/ports/repositories";
import type { Trade } from "@domain/entities";
import { subDays } from "date-fns";

export interface EquityPoint {
  date: string;
  equity: number;
  cumulativeProfit: number;
}

export interface CalculateEquityCurveInput {
  accountId: string;
  query?: Omit<TradeQuery, "accountId">;
  includeDeposits?: boolean;
}

export class CalculateEquityCurveUseCase {
  constructor(private readonly tradeRepo: ITradeRepository) {}

  async execute(input: CalculateEquityCurveInput): Promise<EquityPoint[]> {
    const trades = await this.tradeRepo.list({
      ...input.query,
      accountId: input.accountId,
    });

    if (trades.length === 0) {
      return [];
    }

    const sorted = [...trades].sort(
      (a, b) => a.openTime.getTime() - b.openTime.getTime()
    );

    const points: EquityPoint[] = [];
    let cumulative = 0;

    for (const trade of sorted) {
      const net = trade.netProfit ?? trade.grossProfit ?? 0;
      cumulative += net;
      points.push({
        date: trade.openTime.toISOString(),
        equity: cumulative,
        cumulativeProfit: cumulative,
      });
    }

    return points;
  }
}
