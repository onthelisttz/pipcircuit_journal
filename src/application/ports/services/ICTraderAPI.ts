export interface CTraderTokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: string;
}

export interface CTraderAccountInfo {
  accountNumber: string;
  broker?: string;
  name?: string;
  type?: "Demo" | "Live";
  currency?: string;
  balance?: number;
  equity?: number;
}

export interface CTraderTradeRecord {
  ticketId: string;
  symbol: string;
  direction: "Buy" | "Sell";
  orderType: "Market" | "Limit" | "Stop";
  openTime: string;
  closeTime?: string | null;
  openPrice: number;
  closePrice?: number | null;
  volume: number;
  commission?: number;
  swap?: number;
  fee?: number;
  grossProfit?: number;
  netProfit?: number;
  percentGain?: number;
  takeProfit?: number | null;
  stopLoss?: number | null;
  placedBy?: "Algo" | "Dealer" | "Manual" | "Mobile";
  outcome?: "TakeProfit" | "StopLoss" | "Breakeven" | "Partial" | "Manual";
}

export interface CTraderBarRecord {
  symbol: string;
  timeframe: "M1" | "M5" | "M15" | "M30" | "H1" | "H4" | "D1";
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface ICTraderAPI {
  getAuthUrl(state?: string): string;
  exchangeCodeForToken(code: string): Promise<CTraderTokenResponse>;
  refreshToken(refreshToken: string): Promise<CTraderTokenResponse>;
  getAccounts(accessToken: string): Promise<CTraderAccountInfo[]>;
  getTrades(
    accessToken: string,
    accountNumber: string,
    from?: string,
    to?: string
  ): Promise<CTraderTradeRecord[]>;
  getBars(
    accessToken: string,
    symbol: string,
    timeframe: CTraderBarRecord["timeframe"],
    from: number,
    to: number,
    accountNumber?: string
  ): Promise<CTraderBarRecord[]>;
}
