import { env } from "@config/env";

import type { CTraderTokenResponse } from "@application/ports/services";

export class CTraderAuthClient {
  constructor(
    private readonly oauthBase: string = env.ctraderOauthBase,
    private readonly clientId: string = env.ctraderClientId,
    private readonly redirectUri: string = env.ctraderRedirectUri
  ) {}

  getAuthUrl(state?: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      scope: "accounts",
      product: "web",
    });
    if (state) {
      params.set("state", state);
    }
    return `${this.oauthBase}/my/settings/openapi/grantingaccess/?${params.toString()}`;
  }

  async exchangeCodeForToken(_code: string): Promise<CTraderTokenResponse> {
    throw new Error("Use the server API route to exchange the code for a token.");
  }

  async refreshToken(_refreshToken: string): Promise<CTraderTokenResponse> {
    throw new Error("Use the server API route to refresh the token.");
  }
}
