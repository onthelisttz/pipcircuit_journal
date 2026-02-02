export interface DailySummary {
  id?: number;
  accountId: string;
  date: string;
  netProfit: number;
  grossProfit: number;
  tradesCount: number;
  wins: number;
  losses: number;
  winRate: number;
  maxDrawdown: number;
  averageWin: number;
  averageLoss: number;
  createdAt: Date;
  updatedAt: Date;
}
