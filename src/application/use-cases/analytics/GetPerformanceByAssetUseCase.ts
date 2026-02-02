import type { ITradeRepository, TradeQuery } from "@application/ports/repositories";

export interface AssetPerformance {
  symbol: string;
  count: number;
  profit: number;
  winRate: number;
}

export interface GetPerformanceByAssetInput {
  accountId: string;
  query?: Omit<TradeQuery, "accountId">;
}

export class GetPerformanceByAssetUseCase {
  constructor(private readonly tradeRepo: ITradeRepository) {}

  async execute(input: GetPerformanceByAssetInput): Promise<AssetPerformance[]> {
    const trades = await this.tradeRepo.list({
      ...input.query,
      accountId: input.accountId,
    });

    const closed = trades.filter((t) => t.closeTime && (t.netProfit ?? t.grossProfit) !== undefined);

    const bySymbol = new Map<string, number[]>();

    for (const trade of closed) {
      const symbol = trade.symbol || "Unknown";
      const net = trade.netProfit ?? trade.grossProfit ?? 0;
      const arr = bySymbol.get(symbol) ?? [];
      arr.push(net);
      bySymbol.set(symbol, arr);
    }

    return Array.from(bySymbol.entries())
      .map(([symbol, profits]) => {
        const count = profits.length;
        const profit = profits.reduce((a, b) => a + b, 0);
        const wins = profits.filter((p) => p > 0).length;
        const winRate = count > 0 ? (wins / count) * 100 : 0;
        return { symbol, count, profit, winRate };
      })
      .sort((a, b) => b.count - a.count);
  }
}
