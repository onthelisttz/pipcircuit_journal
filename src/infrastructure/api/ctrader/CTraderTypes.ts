export interface CTraderAccountsResponse {
  accounts: Array<{
    accountNumber: string;
    brokerName?: string;
    name?: string;
    accountType?: "Demo" | "Live";
    currency?: string;
    balance?: number;
    equity?: number;
  }>;
}

export interface CTraderTradesResponse {
  trades: Array<{
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
  }>;
}

export interface CTraderBarsResponse {
  bars: Array<{
    symbol: string;
    timeframe: "M1" | "M5" | "M15" | "M30" | "H1" | "H4" | "D1";
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>;
}
