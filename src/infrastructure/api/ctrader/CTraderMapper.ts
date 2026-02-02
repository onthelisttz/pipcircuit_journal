import type { CTraderBarRecord, CTraderTradeRecord } from "@application/ports/services";
import { Direction, OrderType, PlacedBy, TradeOutcome } from "@domain/enums";
import type { ChartBar, Trade } from "@domain/entities";

export class CTraderMapper {
  static toTrade(accountId: string, trade: CTraderTradeRecord): Trade {
    return {
      accountId,
      ticketId: trade.ticketId,
      symbol: trade.symbol,
      direction: trade.direction === "Buy" ? Direction.Buy : Direction.Sell,
      orderType: this.mapOrderType(trade.orderType),
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
    };
  }

  static toChartBar(bar: CTraderBarRecord): ChartBar {
    return {
      symbol: bar.symbol,
      timeframe: bar.timeframe,
      timestamp: bar.timestamp,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume,
    };
  }

  static mapOrderType(orderType: CTraderTradeRecord["orderType"]): OrderType {
    switch (orderType) {
      case "Limit":
        return OrderType.Limit;
      case "Stop":
        return OrderType.Stop;
      default:
        return OrderType.Market;
    }
  }

  static mapPlacedBy(value?: CTraderTradeRecord["placedBy"]): PlacedBy | undefined {
    if (!value) {
      return undefined;
    }
    switch (value) {
      case "Algo":
        return PlacedBy.Algo;
      case "Dealer":
        return PlacedBy.Dealer;
      case "Mobile":
        return PlacedBy.Mobile;
      default:
        return PlacedBy.Manual;
    }
  }

  static mapOutcome(value?: CTraderTradeRecord["outcome"]): TradeOutcome | undefined {
    if (!value) {
      return undefined;
    }
    switch (value) {
      case "TakeProfit":
        return TradeOutcome.TakeProfit;
      case "StopLoss":
        return TradeOutcome.StopLoss;
      case "Breakeven":
        return TradeOutcome.Breakeven;
      case "Partial":
        return TradeOutcome.Partial;
      default:
        return TradeOutcome.Manual;
    }
  }
}
