import type { ITradeRepository, TradeQuery } from "@application/ports/repositories";

export interface AssetPerformance {
  symbol: string;
  count: number;
  wins: number;
  losses: number;
  profit: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  bestTrade: number;
  worstTrade: number;
  avgDurationMs: number;
  fee: number;
  /** Average percent gain per closed trade for this symbol (using per-trade percentGain). */
  avgGainPercent: number;
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

    // Any trade with a closeTime is closed; missing P&L => 0.
    const closed = trades.filter((t) => t.closeTime);

    const bySymbol = new Map<
      string,
      { profits: number[]; durations: number[]; fees: number[]; percents: number[] }
    >();

    for (const trade of closed) {
      const symbol = trade.symbol || "Unknown";
      const net = trade.netProfit ?? trade.grossProfit ?? 0;
      const commission = trade.commission ?? 0;
      const swap = trade.swap ?? 0;
      const fee = trade.fee ?? 0;
      const totalFee = commission + swap + fee;
      const durationMs =
        trade.closeTime && trade.openTime
          ? trade.closeTime.getTime() - trade.openTime.getTime()
          : 0;
      const percent = trade.percentGain ?? 0;

      const entry = bySymbol.get(symbol) ?? {
        profits: [],
        durations: [],
        fees: [],
        percents: [],
      };
      entry.profits.push(net);
      if (durationMs > 0) entry.durations.push(durationMs);
      entry.fees.push(totalFee);
      if (trade.percentGain != null && Number.isFinite(trade.percentGain)) {
        entry.percents.push(percent);
      }
      bySymbol.set(symbol, entry);
    }

    return Array.from(bySymbol.entries())
      .filter(([symbol]) => !/^\d+$/.test(symbol))
      .map(([symbol, { profits, durations, fees, percents }]) => {
        const count = profits.length;
        const profit = profits.reduce((a, b) => a + b, 0);
        const winProfits = profits.filter((p) => p > 0);
        const lossProfits = profits.filter((p) => p < 0);
        const wins = winProfits.length;
        const losses = lossProfits.length;
        const winRate = count > 0 ? (wins / count) * 100 : 0;
        const avgWin = wins > 0 ? winProfits.reduce((a, b) => a + b, 0) / wins : 0;
        const avgLoss = losses > 0 ? lossProfits.reduce((a, b) => a + b, 0) / losses : 0;
        const bestTrade = profits.length > 0 ? Math.max(...profits) : 0;
        const worstTrade = profits.length > 0 ? Math.min(...profits) : 0;
        const avgDurationMs =
          durations.length > 0
            ? durations.reduce((a, b) => a + b, 0) / durations.length
            : 0;
        const feeTotal = fees.reduce((a, b) => a + b, 0);
        const avgGainPercent =
          percents.length > 0
            ? percents.reduce((a, b) => a + b, 0) / percents.length
            : 0;
        return {
          symbol,
          count,
          wins,
          losses,
          profit,
          winRate,
          avgWin,
          avgLoss,
          bestTrade,
          worstTrade,
          avgDurationMs,
          fee: feeTotal,
          avgGainPercent,
        };
      })
      .sort((a, b) => b.count - a.count);
  }
}
