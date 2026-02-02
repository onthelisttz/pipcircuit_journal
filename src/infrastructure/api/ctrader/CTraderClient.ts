import { env } from "@config/env";

const MAX_REQUESTS_PER_MINUTE = 100;
const WINDOW_MS = 60_000;

export class CTraderClient {
  private readonly requestTimestamps: number[] = [];

  constructor(private readonly baseUrl: string = env.ctraderApiBase) {}

  async get<T>(path: string, accessToken?: string): Promise<T> {
    return this.request<T>(path, { method: "GET" }, accessToken);
  }

  async post<T>(
    path: string,
    body: Record<string, unknown>,
    accessToken?: string
  ): Promise<T> {
    return this.request<T>(
      path,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      accessToken
    );
  }

  private async request<T>(
    path: string,
    init: RequestInit,
    accessToken?: string
  ): Promise<T> {
    await this.throttle();
    const headers = new Headers(init.headers);
    if (accessToken) {
      headers.set("Authorization", `Bearer ${accessToken}`);
    }
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers,
    });
    if (!response.ok) {
      throw new Error(`cTrader API error ${response.status}`);
    }
    return (await response.json()) as T;
  }

  private async throttle(): Promise<void> {
    const now = Date.now();
    this.requestTimestamps.push(now);
    while (this.requestTimestamps.length > 0) {
      const earliest = this.requestTimestamps[0];
      if (now - earliest <= WINDOW_MS) {
        break;
      }
      this.requestTimestamps.shift();
    }
    if (this.requestTimestamps.length > MAX_REQUESTS_PER_MINUTE) {
      const waitFor = WINDOW_MS - (now - this.requestTimestamps[0]);
      await new Promise((resolve) => setTimeout(resolve, waitFor));
    }
  }
}
