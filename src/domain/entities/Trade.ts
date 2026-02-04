import { Direction, Mindset, OrderType, PlacedBy, TradeOutcome } from "../enums";

export interface Trade {
  id?: number;
  accountId: string;
  ticketId?: string;
  symbol: string;
  direction: Direction;
  orderType: OrderType;
  openTime: Date;
  closeTime?: Date | null;
  openPrice: number;
  closePrice?: number | null;
  /** Position entry price (for closed trades, may differ from openPrice) */
  entryPrice?: number | null;
  volume: number;
  lots?: number;
  commission?: number;
  swap?: number;
  fee?: number;
  grossProfit?: number;
  netProfit?: number;
  percentGain?: number;
  takeProfit?: number | null;
  stopLoss?: number | null;
  placedBy?: PlacedBy;
  outcome?: TradeOutcome;
  rating?: number;
  mindset?: Mindset;
  comment?: string | null;
  createdAt: Date;
  updatedAt: Date;
  syncedAt?: Date | null;
  version?: number;
}
