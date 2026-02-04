import type { ITradeRepository, TradeQuery } from "@application/ports/repositories";
import { Direction } from "@domain/enums";

export interface LongShortStats {
  totalLongTrades: number;
  totalLongProfit: number;
  totalShortTrades: number;
  totalShortProfit: number;
}

export interface GetLongShortStatsInput {
  accountId: string;
  query?: Omit<TradeQuery, "accountId">;
}

export class GetLongShortStatsUseCase {
  constructor(private readonly tradeRepo: ITradeRepository) {}

  async execute(input: GetLongShortStatsInput): Promise<LongShortStats> {
    const trades = await this.tradeRepo.list({
      ...input.query,
      accountId: input.accountId,
    });

    const closed = trades.filter((t) => t.closeTime);
    let totalLongTrades = 0;
    let totalLongProfit = 0;
    let totalShortTrades = 0;
    let totalShortProfit = 0;

    for (const trade of closed) {
      const net = trade.netProfit ?? trade.grossProfit ?? 0;
      const isLong = trade.direction === Direction.Buy;
      if (isLong) {
        totalLongTrades++;
        totalLongProfit += net;
      } else {
        totalShortTrades++;
        totalShortProfit += net;
      }
    }

    return {
      totalLongTrades,
      totalLongProfit,
      totalShortTrades,
      totalShortProfit,
    };
  }
}
