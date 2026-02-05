import type { CTraderBarRecord } from "@application/ports/services";
import { CTraderClient } from "./CTraderClient";
import type { CTraderBarsResponse } from "./CTraderTypes";

export class CTraderHistoryClient {
  constructor(private readonly client: CTraderClient = new CTraderClient()) {}

  async getBars(
    accessToken: string,
    symbol: string,
    timeframe: CTraderBarRecord["timeframe"],
    from: number,
    to: number,
    accountNumber?: string
  ): Promise<CTraderBarRecord[]> {
    const response = await fetch("/api/ctrader/bars", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accessToken,
        symbol,
        timeframe,
        from,
        to,
        accountNumber: accountNumber ?? undefined,
      }),
    });
    const data = (await response.json()) as { bars?: CTraderBarRecord[]; error?: string };
    if (!response.ok || data.error) {
      const msg = data.error ?? `Failed to fetch bars (${response.status})`;
      throw new Error(msg);
    }
    return data.bars ?? [];
  }
}
