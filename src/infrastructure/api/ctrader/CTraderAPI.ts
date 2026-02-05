import type {
  CTraderAccountInfo,
  CTraderBarRecord,
  CTraderTokenResponse,
  CTraderTradeRecord,
  ICTraderAPI,
} from "@application/ports/services";
import { CTraderAuthClient } from "./CTraderAuthClient";
import { CTraderHistoryClient } from "./CTraderHistoryClient";
import { CTraderTradeClient } from "./CTraderTradeClient";

export class CTraderAPI implements ICTraderAPI {
  constructor(
    private readonly authClient: CTraderAuthClient = new CTraderAuthClient(),
    private readonly tradeClient: CTraderTradeClient = new CTraderTradeClient(),
    private readonly historyClient: CTraderHistoryClient = new CTraderHistoryClient()
  ) {}

  getAuthUrl(state?: string): string {
    return this.authClient.getAuthUrl(state);
  }

  exchangeCodeForToken(code: string): Promise<CTraderTokenResponse> {
    return this.authClient.exchangeCodeForToken(code);
  }

  refreshToken(refreshToken: string): Promise<CTraderTokenResponse> {
    return this.authClient.refreshToken(refreshToken);
  }

  getAccounts(accessToken: string): Promise<CTraderAccountInfo[]> {
    return this.tradeClient.getAccounts(accessToken);
  }

  getTrades(
    accessToken: string,
    accountNumber: string,
    from?: string,
    to?: string
  ): Promise<CTraderTradeRecord[]> {
    return this.tradeClient.getTrades(accessToken, accountNumber, from, to);
  }

  getBars(
    accessToken: string,
    symbol: string,
    timeframe: CTraderBarRecord["timeframe"],
    from: number,
    to: number,
    accountNumber?: string
  ): Promise<CTraderBarRecord[]> {
    return this.historyClient.getBars(accessToken, symbol, timeframe, from, to, accountNumber);
  }
}
