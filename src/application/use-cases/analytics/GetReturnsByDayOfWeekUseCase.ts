import type { ITradeRepository, TradeQuery } from "@application/ports/repositories";
import { getDay } from "date-fns";

export interface DayOfWeekReturn {
  dayOfWeek: string;
  dayOrder: number;
  profit: number;
  tradeCount: number;
  winning: number;
  losing: number;
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export interface GetReturnsByDayOfWeekInput {
  accountId: string;
  query?: Omit<TradeQuery, "accountId">;
}

export class GetReturnsByDayOfWeekUseCase {
  constructor(private readonly tradeRepo: ITradeRepository) {}

  async execute(input: GetReturnsByDayOfWeekInput): Promise<DayOfWeekReturn[]> {
    const trades = await this.tradeRepo.list({
      ...input.query,
      accountId: input.accountId,
    });

    const closed = trades.filter((t) => t.closeTime);
    const byDay = new Map<number, { profit: number; count: number; winning: number; losing: number }>();

    for (let i = 0; i < 7; i++) {
      byDay.set(i, { profit: 0, count: 0, winning: 0, losing: 0 });
    }

    for (const trade of closed) {
      const net = trade.netProfit ?? trade.grossProfit ?? 0;
      const closeTime = trade.closeTime!;
      const dayNum = getDay(closeTime);
      const winning = net > 0 ? net : 0;
      const losing = net < 0 ? net : 0;

      const d = byDay.get(dayNum)!;
      d.profit += net;
      d.count += 1;
      d.winning += winning;
      d.losing += losing;
    }

    return Array.from(byDay.entries())
      .sort(([a], [b]) => a - b)
      .map(([dayNum, { profit, count, winning, losing }]) => ({
        dayOfWeek: DAY_NAMES[dayNum],
        dayOrder: dayNum,
        profit,
        tradeCount: count,
        winning,
        losing,
      }));
  }
}
