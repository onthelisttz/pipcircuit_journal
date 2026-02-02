import type { ICTraderAPI, CTraderTokenResponse } from "@application/ports/services";

export class ExchangeCTraderCodeUseCase {
  constructor(private readonly api: ICTraderAPI) {}

  async execute(code: string): Promise<CTraderTokenResponse> {
    return this.api.exchangeCodeForToken(code);
  }
}
