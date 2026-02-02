import type { CTraderAccountInfo, CTraderTradeRecord } from "@application/ports/services";
import { CTraderClient } from "./CTraderClient";
import type { CTraderAccountsResponse, CTraderTradesResponse } from "./CTraderTypes";

export class CTraderTradeClient {
  constructor(private readonly client: CTraderClient = new CTraderClient()) {}

  async getAccounts(accessToken: string): Promise<CTraderAccountInfo[]> {
    const response = await this.client.get<CTraderAccountsResponse>("/accounts", accessToken);
    return response.accounts.map((account) => ({
      accountNumber: account.accountNumber,
      broker: account.brokerName,
      name: account.name,
      type: account.accountType,
      currency: account.currency,
      balance: account.balance,
      equity: account.equity,
    }));
  }

  async getTrades(
    accessToken: string,
    accountNumber: string,
    from?: string,
    to?: string
  ): Promise<CTraderTradeRecord[]> {
    const response = await fetch("/api/ctrader/trades", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accessToken,
        accountNumber,
        from: from ? new Date(from).getTime() : undefined,
        to: to ? new Date(to).getTime() : undefined,
      }),
    });
    const data = (await response.json()) as { trades?: CTraderTradeRecord[]; error?: string };
    if (!response.ok || data.error) {
      throw new Error(data.error ?? "Failed to fetch trades");
    }
    return data.trades ?? [];
  }
}
