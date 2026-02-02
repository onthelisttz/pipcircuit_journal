import { DomainError } from "./DomainError";

export class TradeNotFoundError extends DomainError {
  constructor(tradeId: number | string) {
    super(`Trade not found: ${tradeId}`, "TRADE_NOT_FOUND", { tradeId });
    this.name = "TradeNotFoundError";
  }
}
