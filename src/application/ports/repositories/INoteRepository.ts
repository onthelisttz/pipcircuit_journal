import type { TradeNote } from "@domain/entities";

export interface INoteRepository {
  getById(id: number): Promise<TradeNote | null>;
  listByTradeId(tradeId: number): Promise<TradeNote[]>;
  create(note: TradeNote): Promise<TradeNote>;
  update(id: number, updates: Partial<TradeNote>): Promise<TradeNote>;
  delete(id: number): Promise<void>;
}
