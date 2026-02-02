export interface TradeNote {
  id?: number;
  tradeId: number;
  content: string;
  createdAt: Date;
  updatedAt: Date;
  syncedAt?: Date | null;
  version?: number;
}
