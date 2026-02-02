import type { ICTraderAPI } from "@application/ports/services";
import type { ITradeRepository } from "@application/ports/repositories";
import { Direction, OrderType, PlacedBy, TradeOutcome } from "@domain/enums";
import type { Trade } from "@domain/entities";

export interface ImportTradesParams {
  accessToken: string;
  accountId: string;
  accountNumber: string;
  from?: string;
  to?: string;
}

export class ImportTradesUseCase {
  constructor(
    private readonly api: ICTraderAPI,
    private readonly tradeRepository: ITradeRepository
  ) {}

  async execute(params: ImportTradesParams): Promise<Trade[]> {
    const trades = await this.api.getTrades(
      params.accessToken,
      params.accountNumber,
      params.from,
      params.to
    );

    const mapped = trades.map((trade) => ({
      accountId: params.accountId,
      ticketId: trade.ticketId,
      symbol: trade.symbol,
      direction: trade.direction === "Buy" ? Direction.Buy : Direction.Sell,
      orderType:
        trade.orderType === "Limit"
          ? OrderType.Limit
          : trade.orderType === "Stop"
            ? OrderType.Stop
            : OrderType.Market,
      openTime: new Date(trade.openTime),
      closeTime: trade.closeTime ? new Date(trade.closeTime) : null,
      openPrice: trade.openPrice,
      closePrice: trade.closePrice ?? null,
      volume: trade.volume,
      commission: trade.commission,
      swap: trade.swap,
      fee: trade.fee,
      grossProfit: trade.grossProfit,
      netProfit: trade.netProfit,
      percentGain: trade.percentGain,
      takeProfit: trade.takeProfit ?? null,
      stopLoss: trade.stopLoss ?? null,
      placedBy: this.mapPlacedBy(trade.placedBy),
      outcome: this.mapOutcome(trade.outcome),
      createdAt: new Date(),
      updatedAt: new Date(),
    }));

    await this.tradeRepository.bulkUpsert(mapped);
    return mapped;
  }

  private mapPlacedBy(value?: string): PlacedBy | undefined {
    switch (value) {
      case "Algo":
        return PlacedBy.Algo;
      case "Dealer":
        return PlacedBy.Dealer;
      case "Mobile":
        return PlacedBy.Mobile;
      case "Manual":
        return PlacedBy.Manual;
      default:
        return undefined;
    }
  }

  private mapOutcome(value?: string): TradeOutcome | undefined {
    switch (value) {
      case "TakeProfit":
        return TradeOutcome.TakeProfit;
      case "StopLoss":
        return TradeOutcome.StopLoss;
      case "Breakeven":
        return TradeOutcome.Breakeven;
      case "Partial":
        return TradeOutcome.Partial;
      case "Manual":
        return TradeOutcome.Manual;
      default:
        return undefined;
    }
  }
}
