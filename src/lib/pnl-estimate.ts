/**
 * Estimates P&L from price movement when cTrader API does not return grossProfit/netProfit.
 * Uses symbol-specific point/pip values where available.
 */

/** Point value in USD per 1 lot per 1 point movement. cTrader indices: 0.1 lot ≈ $0.10/point (US30), 1 lot = $1/point. */
const POINT_VALUE_PER_LOT: Record<string, number> = {
  US30: 1,
  US100: 1,
  NAS100: 1,
  NSX: 1,
  USTEC: 1,
  US500: 1,
  SPX500: 1,
  DJ30: 1,
  GER40: 1,
  DAX: 1,
  EURUSD: 100000,
  GBPUSD: 100000,
  USDJPY: 100000,
  AUDUSD: 100000,
  USDCAD: 100000,
  USDCHF: 100000,
  NZDUSD: 100000,
  XAUUSD: 100,
  GOLD: 100,
};

/** Pip size for forex pairs (price step for 1 pip). */
const PIP_SIZE: Record<string, number> = {
  USDJPY: 0.01,
  JPY: 0.01,
};

const DEFAULT_POINT_VALUE = 5;
const DEFAULT_PIP_SIZE = 0.0001;
const FX_ALIAS_TO_CURRENCY: Record<string, string> = {
  A: "AUD",
  C: "CAD",
  E: "EUR",
  F: "CHF",
  G: "GBP",
  J: "JPY",
  N: "NZD",
  U: "USD",
};

function normalizeSymbol(symbol: string): string {
  const upper = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!upper) return "";

  if (/^[A-Z]{6}$/.test(upper)) {
    return upper;
  }

  if (/^[A-Z]{2}$/.test(upper)) {
    const base = FX_ALIAS_TO_CURRENCY[upper[0]];
    const quote = FX_ALIAS_TO_CURRENCY[upper[1]];
    if (base && quote) {
      return `${base}${quote}`;
    }
  }

  return upper;
}

function getPointValue(symbol: string): number {
  const upper = normalizeSymbol(symbol);
  for (const [key, val] of Object.entries(POINT_VALUE_PER_LOT)) {
    if (upper.includes(key.replace(/[^A-Z0-9]/g, ""))) {
      return val;
    }
  }
  if (/^[A-Z]{6}$/.test(upper) || upper.includes("USD") || upper.includes("JPY")) {
    return 100000;
  }
  return DEFAULT_POINT_VALUE;
}

function getPipSize(symbol: string): number {
  const upper = normalizeSymbol(symbol);
  if (upper.includes("JPY")) return 0.01;
  return DEFAULT_PIP_SIZE;
}

function isForex(symbol: string): boolean {
  const upper = normalizeSymbol(symbol);
  // Metals (XAUUSD, GOLD, etc.) use point value, not pip value - exclude from forex
  if (upper === "XAUUSD" || upper === "GOLD" || upper.startsWith("XAU")) return false;
  return (
    /^[A-Z]{6}$/.test(upper) ||
    (upper.length >= 6 && (upper.includes("USD") || upper.includes("EUR") || upper.includes("GBP")))
  );
}

/**
 * Convert cTrader API volume to lots.
 * Per cTrader ProtoOA and Pepperstone statement:
 * - Forex: raw in cents (100=1 lot). 5=0.05, 50=0.5. Or units (100000=1 lot) when >= 1000.
 * - Indices: raw in cents (100=1 lot). 10=0.1 lots.
 * - XAUUSD: raw in cents (10000=1 lot per Pepperstone). 100=0.01 lots.
 * - If volume < 1, assume already in lots.
 */
export function volumeToLots(volume: number, symbol: string): number {
  if (!Number.isFinite(volume) || volume <= 0) return 0;
  if (volume < 1) return volume;
  const upper = normalizeSymbol(symbol);
  if (upper === "XAUUSD" || upper === "GOLD") {
    return volume >= 100 ? volume / 10_000 : volume / 100;
  }
  if (isForex(upper)) {
    return volume >= 1000 ? volume / 100_000 : volume / 100;
  }
  return volume / 100;
}

/**
 * Estimate gross profit from price movement.
 * @param entryPrice - Position entry price
 * @param closePrice - Exit price
 * @param volume - Lot size
 * @param direction - "Buy" or "Sell"
 * @param symbol - Instrument symbol (e.g. US30, NAS100, EURUSD)
 */
export function estimateGrossProfit(
  entryPrice: number,
  closePrice: number,
  volume: number,
  direction: string,
  symbol: string
): number {
  if (!Number.isFinite(entryPrice) || !Number.isFinite(closePrice) || !Number.isFinite(volume) || volume <= 0) {
    return 0;
  }

  const isBuy = direction === "Buy" || direction === "BUY";
  const priceDiff = isBuy ? closePrice - entryPrice : entryPrice - closePrice;

  if (isForex(symbol)) {
    const pipSize = getPipSize(symbol);
    const pipValue = 10;
    const pips = priceDiff / pipSize;
    return pips * pipValue * volume;
  }

  const pointValue = getPointValue(symbol);
  return priceDiff * volume * pointValue;
}

/** Point size for non-forex instruments (smallest price step). */
const POINT_SIZE: Record<string, number> = {
  US30: 1,
  US100: 1,
  NAS100: 1,
  XAUUSD: 0.01,
  GOLD: 0.01,
};

function getPointSize(symbol: string): number {
  const upper = normalizeSymbol(symbol);
  for (const [key, val] of Object.entries(POINT_SIZE)) {
    if (upper.includes(key.replace(/[^A-Z0-9]/g, ""))) {
      return val;
    }
  }
  if (upper === "XAUUSD" || upper === "GOLD" || upper.startsWith("XAU")) return 0.01;
  return 1;
}

/**
 * Convert price difference to pips (forex) or points (indices/metals) for display.
 * Positive = favorable, negative = adverse.
 */
export function priceDiffToPips(priceDiff: number, symbol: string): number {
  if (!Number.isFinite(priceDiff)) return 0;
  const upper = normalizeSymbol(symbol);
  if (isForex(upper)) {
    const pipSize = getPipSize(upper);
    return priceDiff / pipSize;
  }
  const pointSize = getPointSize(upper);
  return priceDiff / pointSize;
}

/**
 * Format price difference as pips/points label (e.g. "-3", "+6").
 */
export function formatPipsLabel(priceDiff: number, symbol: string): string {
  const pips = priceDiffToPips(priceDiff, symbol);
  const rounded = Math.round(pips * 10) / 10; // 1 decimal
  const sign = rounded > 0 ? "+" : rounded < 0 ? "" : "";
  return `${sign}${rounded}`;
}
