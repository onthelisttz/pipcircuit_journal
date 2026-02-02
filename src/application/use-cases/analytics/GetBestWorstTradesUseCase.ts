import type { ITradeRepository, TradeQuery } from "@application/ports/repositories";
import type { Trade } from "@domain/entities";

export interface BestWorstTradesResult {
  best: Trade[];
  worst: Trade[];
}

export interface GetBestWorstTradesInput {
  accountId: string;
  query?: Omit<TradeQuery, "accountId">;
  limit?: number;
}

export class GetBestWorstTradesUseCase {
  constructor(private readonly tradeRepo: ITradeRepository) {}

  async execute(input: GetBestWorstTradesInput): Promise<BestWorstTradesResult> {
    const limit = input.limit ?? 5;
    const trades = await this.tradeRepo.list({
      ...input.query,
      accountId: input.accountId,
    });

    const closed = trades.filter((t) => t.closeTime && (t.netProfit ?? t.grossProfit) !== undefined);

    const sorted = [...closed].sort(
      (a, b) => (b.netProfit ?? b.grossProfit ?? 0) - (a.netProfit ?? a.grossProfit ?? 0)
    );

    const best = sorted.slice(0, limit);
    const worst = sorted.slice(-limit).reverse();

    return { best, worst };
  }
}
