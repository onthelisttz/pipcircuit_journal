import type { ITradeRepository, TradeQuery } from "@application/ports/repositories";
import { format, startOfYear, startOfMonth, startOfDay } from "date-fns";

export interface PeriodReturn {
  period: string;
  profit: number;
  tradeCount: number;
}

export interface ReturnsByPeriodResult {
  annual: PeriodReturn[];
  monthly: PeriodReturn[];
  daily: PeriodReturn[];
}

export interface GetReturnsByPeriodInput {
  accountId: string;
  query?: Omit<TradeQuery, "accountId">;
}

export class GetReturnsByPeriodUseCase {
  constructor(private readonly tradeRepo: ITradeRepository) {}

  async execute(input: GetReturnsByPeriodInput): Promise<ReturnsByPeriodResult> {
    const trades = await this.tradeRepo.list({
      ...input.query,
      accountId: input.accountId,
    });

    const closed = trades.filter((t) => t.closeTime && (t.netProfit ?? t.grossProfit) !== undefined);

    const byYear = new Map<string, { profit: number; count: number }>();
    const byMonth = new Map<string, { profit: number; count: number }>();
    const byDay = new Map<string, { profit: number; count: number }>();

    for (const trade of closed) {
      const net = trade.netProfit ?? trade.grossProfit ?? 0;
      const closeTime = trade.closeTime!;

      const yearKey = format(startOfYear(closeTime), "yyyy");
      const monthKey = format(startOfMonth(closeTime), "yyyy-MM");
      const dayKey = format(startOfDay(closeTime), "yyyy-MM-dd");

      const y = byYear.get(yearKey) ?? { profit: 0, count: 0 };
      y.profit += net;
      y.count += 1;
      byYear.set(yearKey, y);

      const m = byMonth.get(monthKey) ?? { profit: 0, count: 0 };
      m.profit += net;
      m.count += 1;
      byMonth.set(monthKey, m);

      const d = byDay.get(dayKey) ?? { profit: 0, count: 0 };
      d.profit += net;
      d.count += 1;
      byDay.set(dayKey, d);
    }

    const annual = Array.from(byYear.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([period, { profit, count }]) => ({ period, profit, tradeCount: count }));

    const monthly = Array.from(byMonth.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([period, { profit, count }]) => ({ period, profit, tradeCount: count }));

    const daily = Array.from(byDay.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([period, { profit, count }]) => ({ period, profit, tradeCount: count }));

    return { annual, monthly, daily };
  }
}
