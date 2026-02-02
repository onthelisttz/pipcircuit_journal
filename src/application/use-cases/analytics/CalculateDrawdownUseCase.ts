import type { ITradeRepository, TradeQuery } from "@application/ports/repositories";

export interface DrawdownPoint {
  date: string;
  drawdown: number;
  peak: number;
  equity: number;
}

export interface CalculateDrawdownInput {
  accountId: string;
  query?: Omit<TradeQuery, "accountId">;
}

export class CalculateDrawdownUseCase {
  constructor(private readonly tradeRepo: ITradeRepository) {}

  async execute(input: CalculateDrawdownInput): Promise<DrawdownPoint[]> {
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

    const points: DrawdownPoint[] = [];
    let cumulative = 0;
    let peak = 0;

    for (const trade of sorted) {
      const net = trade.netProfit ?? trade.grossProfit ?? 0;
      cumulative += net;
      peak = Math.max(peak, cumulative);
      const drawdown = peak - cumulative;
      points.push({
        date: trade.openTime.toISOString(),
        drawdown,
        peak,
        equity: cumulative,
      });
    }

    return points;
  }
}
