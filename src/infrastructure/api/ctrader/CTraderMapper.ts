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
    // Normalize broker-specific raw price formats to human-readable decimals,
    // matching how trade prices are stored.
    const normalizePrice = (symbol: string, price: number): number => {
      const s = symbol.toUpperCase();

      // Indices and metals often come as scaled integers (e.g. 448246000, 3412700)
      // while FX pairs may already be proper decimals.
      if (s.includes("XAU")) {
        // XAUUSD-style prices: 3412700 -> 3412.7
        return Number((price / 1000).toFixed(2));
      }

      if (s === "US30" || s === "NAS100" || s === "GER40" || s === "JPN225") {
        // Index prices: 448246000 -> 44824.6, 233150000 -> 23315.0 etc.
        return Number((price / 10000).toFixed(1));
      }

      if (s.endsWith("JPY")) {
        // JPY pairs sometimes arrive scaled by 10: 14755.9 -> 147.559
        // Heuristic: values >> 1000 are assumed to be scaled.
        if (price > 1000) {
          return Number((price / 100).toFixed(3));
        }
        return Number(price.toFixed(3));
      }

      // Default: assume already a proper FX-style decimal.
      return Number(price.toFixed(5));
    };

    return {
      symbol: bar.symbol,
      timeframe: bar.timeframe,
      timestamp: bar.timestamp,
      open: normalizePrice(bar.symbol, bar.open),
      high: normalizePrice(bar.symbol, bar.high),
      low: normalizePrice(bar.symbol, bar.low),
      close: normalizePrice(bar.symbol, bar.close),
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
