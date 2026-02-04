import type { ITradeRepository, TradeQuery } from "@application/ports/repositories";
import { format, startOfYear, startOfMonth, startOfDay } from "date-fns";

export interface PeriodReturn {
  period: string;
  profit: number;
  tradeCount: number;
  winning: number;
  losing: number;
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

    // Closed = has a closeTime; P&L defaults to 0 when missing.
    const closed = trades.filter((t) => t.closeTime);

    const byYear = new Map<string, { profit: number; count: number; winning: number; losing: number }>();
    const byMonth = new Map<string, { profit: number; count: number; winning: number; losing: number }>();
    const byDay = new Map<string, { profit: number; count: number; winning: number; losing: number }>();

    for (const trade of closed) {
      const net = trade.netProfit ?? trade.grossProfit ?? 0;
      const closeTime = trade.closeTime!;
      const winning = net > 0 ? net : 0;
      const losing = net < 0 ? net : 0;

      const yearKey = format(startOfYear(closeTime), "yyyy");
      const monthKey = format(startOfMonth(closeTime), "yyyy-MM");
      const dayKey = format(startOfDay(closeTime), "yyyy-MM-dd");

      const y = byYear.get(yearKey) ?? { profit: 0, count: 0, winning: 0, losing: 0 };
      y.profit += net;
      y.count += 1;
      y.winning += winning;
      y.losing += losing;
      byYear.set(yearKey, y);

      const m = byMonth.get(monthKey) ?? { profit: 0, count: 0, winning: 0, losing: 0 };
      m.profit += net;
      m.count += 1;
      m.winning += winning;
      m.losing += losing;
      byMonth.set(monthKey, m);

      const d = byDay.get(dayKey) ?? { profit: 0, count: 0, winning: 0, losing: 0 };
      d.profit += net;
      d.count += 1;
      d.winning += winning;
      d.losing += losing;
      byDay.set(dayKey, d);
    }

    const annual = Array.from(byYear.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([period, { profit, count, winning, losing }]) => ({
        period,
        profit,
        tradeCount: count,
        winning,
        losing,
      }));

    const monthly = Array.from(byMonth.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([period, { profit, count, winning, losing }]) => ({
        period,
        profit,
        tradeCount: count,
        winning,
        losing,
      }));

    const daily = Array.from(byDay.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([period, { profit, count, winning, losing }]) => ({
        period,
        profit,
        tradeCount: count,
        winning,
        losing,
      }));

    return { annual, monthly, daily };
  }
}
