import { Direction, Mindset, TagCategory, TradeOutcome } from "@domain/enums";
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
  /** Include only trades with these rating values. */
  ratingValues?: number[];
  /** Include only trades with these mindsets. */
  mindsets?: Mindset[];
  /** Include only trades with a numeric rating. */
  hasRating?: boolean;
  /** Include only trades with mindset set. */
  hasMindset?: boolean;
  /** Include trades that have at least one tag in any of these categories. */
  tagCategories?: TagCategory[];
  ratingMin?: number;
  ratingMax?: number;
  /** Fetch only trades with these IDs */
  ids?: number[];
  /** Fetch only winning trades (closed, profit > 0) */
  winsOnly?: boolean;
  /** Fetch only losing trades (closed, profit < 0) */
  lossesOnly?: boolean;
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
