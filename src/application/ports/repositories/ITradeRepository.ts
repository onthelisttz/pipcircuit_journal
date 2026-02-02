import { Direction, TradeOutcome } from "@domain/enums";
import type { Trade } from "@domain/entities";

export interface TradeQuery {
  accountId?: string;
  symbol?: string;
  symbols?: string[];
  direction?: Direction;
  outcome?: TradeOutcome;
  from?: Date;
  to?: Date;
  tagIds?: number[];
  ratingMin?: number;
  ratingMax?: number;
}

export interface ITradeRepository {
  getById(id: number): Promise<Trade | null>;
  list(query?: TradeQuery): Promise<Trade[]>;
  getByAccountId(accountId: string): Promise<Trade[]>;
  create(trade: Trade): Promise<Trade>;
  update(id: number, updates: Partial<Trade>): Promise<Trade>;
  delete(id: number): Promise<void>;
  bulkUpsert(trades: Trade[]): Promise<void>;
}
