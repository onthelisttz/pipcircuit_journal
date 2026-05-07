import http from "node:http";
import https from "node:https";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const SERVICE_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SERVICE_DIR, "..", "..");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  const content = fs.readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) continue;

    const key = line.slice(0, separatorIndex).trim();
    if (!key || process.env[key] != null) continue;

    let value = line.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

loadEnvFile(path.join(PROJECT_ROOT, ".env"));
loadEnvFile(path.join(PROJECT_ROOT, ".env.local"));

const clientId = process.env.NEXT_PUBLIC_CTRADER_CLIENT_ID ?? "";
const clientSecret = process.env.CTRADER_CLIENT_SECRET ?? "";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const protoLiveHost = process.env.CTRADER_PROTO_HOST_LIVE ?? "live.ctraderapi.com";
const protoDemoHost = process.env.CTRADER_PROTO_HOST_DEMO ?? "demo.ctraderapi.com";
const protoPort = Number(process.env.CTRADER_PROTO_PORT ?? "5035");
const SESSION_TTL_MS = 60_000;
const KEEPALIVE_MS = 15_000;
const HEARTBEAT_MS = 25_000;

const trendbarMap = {
  M1: 1,
  M2: 2,
  M3: 3,
  M4: 4,
  M5: 5,
  M10: 6,
  M15: 7,
  M30: 8,
  H1: 9,
  H4: 10,
  H12: 11,
  D1: 12,
  W1: 13,
  MN1: 14,
};

function toNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  if (value && typeof value === "object" && typeof value.toString === "function") {
    const parsed = Number(value.toString());
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function normalizeSymbol(symbol) {
  return String(symbol ?? "").replace("/", "").trim().toUpperCase();
}

function normalizeAlertCondition(value) {
  return String(value ?? "").trim().toLowerCase() === "below" ? "below" : "above";
}

function normalizeAlertPriceSide(value) {
  return String(value ?? "").trim().toLowerCase() === "ask" ? "ask" : "bid";
}

function sanitizePriceAlert(alert) {
  const targetPrice = toNumber(alert?.targetPrice);
  if (!alert?.id || !Number.isFinite(targetPrice)) {
    return null;
  }

  return {
    id: String(alert.id),
    broker: String(alert.broker ?? ""),
    symbol: normalizeSymbol(alert.symbol),
    condition: normalizeAlertCondition(alert.condition),
    priceSide: normalizeAlertPriceSide(alert.priceSide),
    targetPrice,
    note: typeof alert.note === "string" && alert.note.trim() ? alert.note.trim() : null,
    isActive: alert.isActive !== false,
  };
}

function buildSupabaseUserClient(accessToken) {
  if (!supabaseUrl || !supabaseAnonKey || !accessToken) {
    return null;
  }

  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });
}

function normalizePrice(raw) {
  const parsed = toNumber(raw);
  if (parsed === undefined) return undefined;
  return parsed / 100_000;
}

function volumeToLots(volume, symbol, symbolMeta = null) {
  if (!Number.isFinite(volume) || volume <= 0) return 0;

  const lotSize = toNumber(symbolMeta?.lotSize);
  if (Number.isFinite(lotSize) && lotSize > 0) {
    return volume / lotSize;
  }

  const normalized = normalizeSymbol(symbol);
  if (normalized === "XAUUSD" || normalized === "GOLD") {
    return volume >= 100 ? volume / 10_000 : volume / 100;
  }
  if (/^[A-Z]{6}$/.test(normalized) || normalized.includes("USD") || normalized.includes("JPY")) {
    return volume >= 1000 ? volume / 100_000 : volume / 100;
  }

  return volume / 100;
}

function lotsToVolume(lots, symbol, symbolMeta = null) {
  if (!Number.isFinite(lots) || lots <= 0) {
    throw new Error("Lot size must be greater than zero.");
  }

  const lotSize = toNumber(symbolMeta?.lotSize);
  const minVolume = toNumber(symbolMeta?.minVolume);
  const maxVolume = toNumber(symbolMeta?.maxVolume);
  const stepVolume = toNumber(symbolMeta?.stepVolume);

  if (Number.isFinite(lotSize) && lotSize > 0) {
    let volume = Math.round(lots * lotSize);
    if (Number.isFinite(stepVolume) && stepVolume > 0) {
      const stepped = Math.round(volume / stepVolume) * stepVolume;
      volume = stepped > 0 ? stepped : stepVolume;
    }
    if (Number.isFinite(minVolume) && minVolume > 0) {
      volume = Math.max(volume, minVolume);
    }
    if (Number.isFinite(maxVolume) && maxVolume > 0) {
      volume = Math.min(volume, maxVolume);
    }
    return Math.max(1, Math.round(volume));
  }

  const normalized = normalizeSymbol(symbol);
  if (normalized === "XAUUSD" || normalized === "GOLD") {
    return Math.max(1, Math.round(lots * 10_000));
  }

  if (/^[A-Z]{6}$/.test(normalized) || normalized.includes("USD") || normalized.includes("JPY")) {
    return Math.max(1, Math.round(lots * 100_000));
  }

  return Math.max(1, Math.round(lots * 100));
}

function normalizePriceForSymbol(price, symbolMeta = null) {
  if (!Number.isFinite(price)) return undefined;

  const digits = toNumber(symbolMeta?.digits);
  if (Number.isFinite(digits) && digits >= 0) {
    return Number(price.toFixed(digits));
  }

  return Number(price.toFixed(5));
}

function getMinimumReasonablePrice(symbol) {
  const normalized = normalizeSymbol(symbol);
  if (normalized === "XAUUSD" || normalized === "GOLD") {
    return 1;
  }
  if (normalized === "XAGUSD" || normalized === "SILVER") {
    return 0.1;
  }
  if (/^[A-Z]{6}$/.test(normalized)) {
    return 0.01;
  }
  return 0.0001;
}

function isPriceReasonableAgainstAnchor(price, anchorPrice) {
  if (!Number.isFinite(anchorPrice) || anchorPrice <= 0) {
    return true;
  }
  return price >= anchorPrice * 0.2 && price <= anchorPrice * 5;
}

function sanitizeLivePrice(price, symbol, anchorPrice) {
  if (!Number.isFinite(price) || price <= 0) return undefined;
  if (price < getMinimumReasonablePrice(symbol)) return undefined;
  if (!isPriceReasonableAgainstAnchor(price, anchorPrice)) return undefined;
  return price;
}

function getAnchorPriceFromPayload(payload) {
  const candidates = [
    payload?.bid,
    payload?.ask,
    payload?.currentBar?.close,
    payload?.currentBar?.open,
  ];

  for (const candidate of candidates) {
    if (Number.isFinite(candidate) && candidate > 0) {
      return candidate;
    }
  }

  return undefined;
}

function sanitizeTrendbar(bar, symbol, anchorPrice) {
  if (!bar || typeof bar !== "object") return null;

  const open = sanitizeLivePrice(toNumber(bar.open), symbol, anchorPrice);
  const high = sanitizeLivePrice(toNumber(bar.high), symbol, anchorPrice);
  const low = sanitizeLivePrice(toNumber(bar.low), symbol, anchorPrice);
  const close = sanitizeLivePrice(toNumber(bar.close), symbol, anchorPrice);
  const timestamp = toNumber(bar.timestamp);
  const volume = toNumber(bar.volume) ?? 0;

  if (
    open === undefined ||
    high === undefined ||
    low === undefined ||
    close === undefined ||
    !Number.isFinite(timestamp)
  ) {
    return null;
  }
  if (high < low || open < low || open > high || close < low || close > high) {
    return null;
  }

  return {
    timestamp,
    open,
    high,
    low,
    close,
    volume,
  };
}

function toTradeSide(value) {
  return String(value ?? "").toUpperCase().includes("SELL") ? "Sell" : "Buy";
}

function mapPosition(position, symbol, symbolMeta = null) {
  const tradeData = position?.tradeData ?? {};
  const volume = toNumber(tradeData?.volume) ?? 0;
  return {
    positionId: String(position?.positionId ?? ""),
    symbol,
    direction: toTradeSide(tradeData?.tradeSide),
    volume,
    lots: volumeToLots(volume, symbol, symbolMeta),
    openTimestamp: toNumber(tradeData?.openTimestamp) ?? null,
    entryPrice: toNumber(position?.price) ?? null,
    stopLoss: toNumber(position?.stopLoss) ?? null,
    takeProfit: toNumber(position?.takeProfit) ?? null,
    trailingStopLoss: Boolean(position?.trailingStopLoss),
    label: typeof tradeData?.label === "string" ? tradeData.label : "",
    comment: typeof tradeData?.comment === "string" ? tradeData.comment : "",
    updatedAt: toNumber(position?.utcLastUpdateTimestamp) ?? null,
  };
}

function mapOrder(order, symbol, symbolMeta = null) {
  const tradeData = order?.tradeData ?? {};
  const volume = toNumber(tradeData?.volume) ?? 0;
  return {
    orderId: String(order?.orderId ?? ""),
    symbol,
    direction: toTradeSide(tradeData?.tradeSide),
    orderType: String(order?.orderType ?? ""),
    lots: volumeToLots(volume, symbol, symbolMeta),
    volume,
    limitPrice: toNumber(order?.limitPrice) ?? null,
    stopPrice: toNumber(order?.stopPrice) ?? null,
    stopLoss: toNumber(order?.stopLoss) ?? null,
    takeProfit: toNumber(order?.takeProfit) ?? null,
    createdAt: toNumber(tradeData?.openTimestamp) ?? null,
    expiresAt: toNumber(order?.expirationTimestamp) ?? null,
    positionId: toNumber(order?.positionId) ?? null,
  };
}

function buildSymbolMetaSnapshot(symbolRow) {
  if (!symbolRow || typeof symbolRow !== "object") {
    return null;
  }

  return {
    lotSize: toNumber(symbolRow?.lotSize),
    minVolume: toNumber(symbolRow?.minVolume),
    maxVolume: toNumber(symbolRow?.maxVolume),
    stepVolume: toNumber(symbolRow?.stepVolume),
    digits: toNumber(symbolRow?.digits),
  };
}

function sanitizeExecutionEvent(payload) {
  if (!payload || typeof payload !== "object") {
    return {
      executionType: "SNAPSHOT_CONFIRMED",
      errorCode: null,
      orderId: null,
      positionId: null,
      dealId: null,
      orderStatus: null,
      positionStatus: null,
      fillPrice: null,
    };
  }

  return {
    executionType: String(payload?.executionType ?? ""),
    errorCode: typeof payload?.errorCode === "string" ? payload.errorCode : null,
    orderId: toNumber(payload?.order?.orderId) ?? null,
    positionId:
      toNumber(payload?.position?.positionId) ??
      toNumber(payload?.order?.positionId) ??
      null,
    dealId: toNumber(payload?.deal?.dealId) ?? null,
    orderStatus: payload?.order?.orderStatus ? String(payload.order.orderStatus) : null,
    positionStatus: payload?.position?.positionStatus
      ? String(payload.position.positionStatus)
      : null,
    fillPrice:
      toNumber(payload?.deal?.executionPrice) ??
      toNumber(payload?.order?.executionPrice) ??
      toNumber(payload?.position?.price) ??
      null,
  };
}

function pricesRoughlyMatch(left, right) {
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  const scale = Math.max(Math.abs(left), Math.abs(right), 1);
  return Math.abs(left - right) <= Math.max(0.00002, scale * 0.0000015);
}

function optionalPricesEqual(left, right) {
  if (!Number.isFinite(left) && !Number.isFinite(right)) return true;
  return pricesRoughlyMatch(left, right);
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function eventMatchesSymbol(payload, symbolId) {
  const matches = [
    payload?.symbolId,
    payload?.deal?.symbolId,
    payload?.order?.symbolId,
    payload?.position?.symbolId,
    payload?.order?.tradeData?.symbolId,
    payload?.position?.tradeData?.symbolId,
  ]
    .map((value) => toNumber(value))
    .filter((value) => Number.isFinite(value));

  if (matches.length === 0) return true;
  return matches.includes(symbolId);
}

function eventMatchesTradeSide(payload, side) {
  const normalizedSide = String(side ?? "").trim().toUpperCase();
  if (!normalizedSide) return true;

  const matches = [
    payload?.tradeSide,
    payload?.deal?.tradeSide,
    payload?.order?.tradeData?.tradeSide,
    payload?.position?.tradeData?.tradeSide,
  ]
    .map((value) => String(value ?? "").trim().toUpperCase())
    .filter(Boolean);

  if (matches.length === 0) return true;
  return matches.some((value) => value === normalizedSide);
}

function eventMatchesPositionId(payload, positionId) {
  if (!Number.isFinite(positionId) || positionId <= 0) return true;

  const matches = [
    payload?.positionId,
    payload?.position?.positionId,
    payload?.order?.positionId,
    payload?.deal?.positionId,
  ]
    .map((value) => toNumber(value))
    .filter((value) => Number.isFinite(value));

  if (matches.length === 0) return true;
  return matches.includes(positionId);
}

function serializePosition(position) {
  return [
    position?.positionId ?? "",
    position?.direction ?? "",
    position?.volume ?? "",
    position?.entryPrice ?? "",
    position?.stopLoss ?? "",
    position?.takeProfit ?? "",
  ].join("|");
}

function serializeOrder(order) {
  return [
    order?.orderId ?? "",
    order?.direction ?? "",
    order?.orderType ?? "",
    order?.volume ?? "",
    order?.limitPrice ?? "",
    order?.stopPrice ?? "",
    order?.stopLoss ?? "",
    order?.takeProfit ?? "",
  ].join("|");
}

function serializeSnapshot(snapshot) {
  const positions = Array.isArray(snapshot?.positions)
    ? snapshot.positions.map(serializePosition).sort()
    : [];
  const orders = Array.isArray(snapshot?.orders)
    ? snapshot.orders.map(serializeOrder).sort()
    : [];
  return `${positions.join("||")}###${orders.join("||")}`;
}

function mapTrendbar(bar) {
  const low = toNumber(bar?.low);
  const deltaOpen = toNumber(bar?.deltaOpen) ?? 0;
  const deltaClose = toNumber(bar?.deltaClose) ?? 0;
  const deltaHigh = toNumber(bar?.deltaHigh) ?? 0;
  const timestampMinutes = toNumber(bar?.utcTimestampInMinutes);
  if (low === undefined || timestampMinutes === undefined) return null;

  return {
    timestamp: timestampMinutes * 60 * 1000,
    open: (low + deltaOpen) / 100_000,
    high: (low + deltaHigh) / 100_000,
    low: low / 100_000,
    close: (low + deltaClose) / 100_000,
    volume: toNumber(bar?.volume) ?? 0,
  };
}

function mapTickSeries(tickData, options = {}) {
  if (!Array.isArray(tickData) || tickData.length === 0) return [];

  const ticks = [];
  let currentTimestamp = 0;
  let anchorPrice = Number.isFinite(options.anchorPrice) ? options.anchorPrice : undefined;

  for (let index = 0; index < tickData.length; index += 1) {
    const entry = tickData[index] ?? {};
    const rawTimestamp = toNumber(entry.timestamp);
    const rawTick = toNumber(entry.tick);
    if (rawTick === undefined || rawTimestamp === undefined) continue;

    currentTimestamp = index === 0 ? rawTimestamp : currentTimestamp + rawTimestamp;
    const price = sanitizeLivePrice(rawTick / 100_000, options.symbol, anchorPrice);
    if (price === undefined) continue;

    anchorPrice = price;
    ticks.push({
      timestamp: currentTimestamp,
      price,
    });
  }

  return ticks.sort((left, right) => left.timestamp - right.timestamp);
}

async function fetchAccounts(accessToken) {
  const response = await fetchText(
    `https://api.spotware.com/connect/tradingaccounts?access_token=${encodeURIComponent(accessToken)}`,
    {
      method: "GET",
      headers: { Accept: "application/json" },
    }
  );

  const text = response.text;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }

  if (Array.isArray(parsed)) {
    return parsed;
  }

  if (parsed && typeof parsed === "object") {
    const candidates = [
      parsed.accounts,
      parsed.tradingAccounts,
      parsed.accountList,
      parsed.data,
    ];
    for (const candidate of candidates) {
      if (Array.isArray(candidate)) return candidate;
    }
  }

  return [];
}

function getAccountHost(account) {
  const live =
    typeof account?.live === "boolean"
      ? account.live
      : typeof account?.isLive === "boolean"
        ? account.isLive
        : undefined;
  return live ? protoLiveHost : protoDemoHost;
}

function getAccountNumericId(account) {
  return (
    toNumber(account?.accountId) ??
    toNumber(account?.ctidTraderAccountId) ??
    toNumber(account?.id) ??
    0
  );
}

function getAccountIdentifier(account) {
  return String(
    account?.accountNumber ??
      account?.ctidTraderAccountId ??
      account?.accountId ??
      account?.login ??
      account?.id ??
      ""
  );
}

function buildCorsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Cache-Control, Last-Event-ID",
    "Access-Control-Allow-Private-Network": "true",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

function writeJson(response, statusCode, payload, origin) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    ...buildCorsHeaders(origin),
  });
  response.end(JSON.stringify(payload));
}

function writeSse(response, event, payload) {
  if (event) {
    response.write(`event: ${event}\n`);
  }
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function normalizeServiceErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("TRADE permission required")) {
    return "TRADE permission required. Re-link your cTrader account with trading scope and try again.";
  }
  return message;
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk.toString();
      if (body.length > 1_000_000) {
        reject(new Error("Request body too large."));
        request.destroy();
      }
    });
    request.on("end", () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON body."));
      }
    });
    request.on("error", reject);
  });
}

function fetchText(url, options = {}) {
  const runtimeFetch =
    typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : null;

  if (runtimeFetch) {
    return runtimeFetch(url, options).then(async (response) => ({
      ok: response.ok,
      status: response.status,
      text: await response.text(),
    }));
  }

  return new Promise((resolve, reject) => {
    const requestUrl = new URL(url);
    const request = https.request(
      requestUrl,
      {
        method: options.method ?? "GET",
        headers: options.headers ?? {},
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          resolve({
            ok: (response.statusCode ?? 500) >= 200 && (response.statusCode ?? 500) < 300,
            status: response.statusCode ?? 500,
            text: body,
          });
        });
      }
    );

    request.on("error", reject);

    if (typeof options.body === "string" && options.body.length > 0) {
      request.write(options.body);
    }

    request.end();
  });
}

class LiveSessionManager {
  constructor() {
    this.sessions = new Map();
    this.sessionsByKey = new Map();
  }

  buildKey(config) {
    return [
      config.accountId,
      config.host,
      normalizeSymbol(config.symbol),
      config.timeframe.toUpperCase(),
    ].join(":");
  }

  getSessionById(sessionId) {
    return this.sessions.get(sessionId) ?? null;
  }

  async waitForTradeResult(session, runRequest, options = {}) {
    if (!session?.connection) {
      throw new Error("Live session is not connected.");
    }

    const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 12_000;
    const pollIntervalMs = Number.isFinite(options.pollIntervalMs) ? options.pollIntervalMs : 300;
    const startedAt = Date.now();

    return await new Promise((resolve, reject) => {
      let settled = false;
      let timeoutId = null;
      let executionListenerId = null;
      let errorListenerId = null;
      let protocolErrorListenerId = null;

      const cleanup = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        if (executionListenerId) {
          session.connection.removeEventListener(executionListenerId);
          executionListenerId = null;
        }
        if (errorListenerId) {
          session.connection.removeEventListener(errorListenerId);
          errorListenerId = null;
        }
        if (protocolErrorListenerId) {
          session.connection.removeEventListener(protocolErrorListenerId);
          protocolErrorListenerId = null;
        }
      };

      const settle = (callback, value) => {
        if (settled) return;
        settled = true;
        cleanup();
        callback(value);
      };

      const pollSnapshot = async () => {
        if (settled || typeof options.confirmSnapshot !== "function") return;
        if (Date.now() - startedAt >= timeoutMs) {
          settle(reject, new Error("Timed out waiting for cTrader trade confirmation."));
          return;
        }

        try {
          const snapshot = await this.getPositionsSnapshot(session.id);
          if (await options.confirmSnapshot(snapshot)) {
            settle(resolve, null);
            return;
          }
        } catch {
          // Ignore transient reconcile failures and keep polling until timeout.
        }

        if (!settled) {
          void sleep(pollIntervalMs).then(pollSnapshot);
        }
      };

      executionListenerId = session.connection.on("ProtoOAExecutionEvent", (event) => {
        const payload = event?.descriptor ?? event ?? {};
        if (typeof options.matchExecution === "function" && !options.matchExecution(payload)) {
          return;
        }
        settle(resolve, payload);
      });

      errorListenerId = session.connection.on("ProtoOAOrderErrorEvent", (event) => {
        const payload = event?.descriptor ?? event ?? {};
        if (typeof options.matchError === "function" && !options.matchError(payload)) {
          return;
        }
        settle(
          reject,
          new Error(payload?.description || payload?.errorCode || "Trade request failed.")
        );
      });

      protocolErrorListenerId = session.connection.on("ProtoOAErrorRes", (event) => {
        const payload = event?.descriptor ?? event ?? {};
        if (
          typeof options.matchProtocolError === "function" &&
          !options.matchProtocolError(payload)
        ) {
          return;
        }
        settle(
          reject,
          new Error(payload?.description || payload?.errorCode || "Trade request failed.")
        );
      });

      timeoutId = setTimeout(() => {
        settle(reject, new Error("Timed out waiting for cTrader trade confirmation."));
      }, timeoutMs);

      Promise.resolve()
        .then(runRequest)
        .then(() => {
          if (typeof options.confirmSnapshot === "function") {
            void pollSnapshot();
          }
        })
        .catch((error) => {
          settle(reject, error);
        });
    });
  }

  async getPositionsSnapshot(sessionId) {
    const session = this.getSessionById(sessionId);
    if (!session?.connection || !session.config.symbolId) {
      throw new Error("Live session is not available for position lookup.");
    }

    const reconcile = await session.connection.sendCommand("ProtoOAReconcileReq", {
      ctidTraderAccountId: session.config.accountId,
    });

    const rawPositions = Array.isArray(reconcile?.position) ? reconcile.position : [];
    const rawOrders = Array.isArray(reconcile?.order) ? reconcile.order : [];
    const positions = rawPositions
      .map((position) => {
        const symbolId =
          toNumber(position?.tradeData?.symbolId) ??
          toNumber(position?.symbolId);
        const symbolEntry = symbolId != null ? session.config.symbolDirectory?.get(symbolId) : null;
        return mapPosition(
          position,
          symbolEntry?.symbol ?? session.config.symbol,
          symbolEntry?.symbolMeta ?? session.config.symbolMeta
        );
      });
    const orders = rawOrders
      .map((order) => {
        const symbolId =
          toNumber(order?.tradeData?.symbolId) ??
          toNumber(order?.symbolId);
        const symbolEntry = symbolId != null ? session.config.symbolDirectory?.get(symbolId) : null;
        return mapOrder(
          order,
          symbolEntry?.symbol ?? session.config.symbol,
          symbolEntry?.symbolMeta ?? session.config.symbolMeta
        );
      });

    return {
      symbol: session.config.symbol,
      timeframe: session.config.timeframe,
      positions,
      orders,
    };
  }

  async placeOrder(sessionId, request) {
    const session = this.getSessionById(sessionId);
    if (!session?.connection || !session.config.symbolId) {
      throw new Error("Live session is not available for trade execution.");
    }

    const beforeSnapshot = await this.getPositionsSnapshot(sessionId);

    const side = String(request?.side ?? "").trim().toUpperCase();
    const orderType = String(request?.orderType ?? "MARKET").trim().toUpperCase();
    const lots = toNumber(request?.lots);
    const limitPrice = normalizePriceForSymbol(
      toNumber(request?.limitPrice),
      session.config.symbolMeta
    );
    const stopPrice = normalizePriceForSymbol(
      toNumber(request?.stopPrice),
      session.config.symbolMeta
    );
    const stopLoss = normalizePriceForSymbol(
      toNumber(request?.stopLoss),
      session.config.symbolMeta
    );
    const takeProfit = normalizePriceForSymbol(
      toNumber(request?.takeProfit),
      session.config.symbolMeta
    );
    const comment = typeof request?.comment === "string" ? request.comment.trim() : "";
    const label = typeof request?.label === "string" ? request.label.trim() : "";

    if (side !== "BUY" && side !== "SELL") {
      throw new Error("Order side must be BUY or SELL.");
    }
    if (!["MARKET", "LIMIT", "STOP"].includes(orderType)) {
      throw new Error("Order type must be MARKET, LIMIT, or STOP.");
    }

    const volume = lotsToVolume(lots, session.config.symbol, session.config.symbolMeta);
    const payload = {
      ctidTraderAccountId: session.config.accountId,
      symbolId: session.config.symbolId,
      orderType,
      tradeSide: side,
      volume,
      ...(Number.isFinite(limitPrice) ? { limitPrice } : {}),
      ...(Number.isFinite(stopPrice) ? { stopPrice } : {}),
      ...(Number.isFinite(stopLoss) ? { stopLoss } : {}),
      ...(Number.isFinite(takeProfit) ? { takeProfit } : {}),
      ...(comment ? { comment } : {}),
      ...(label ? { label } : {}),
    };

    if (orderType === "LIMIT" && !Number.isFinite(limitPrice)) {
      throw new Error("Limit orders require a limit price.");
    }
    if (orderType === "STOP" && !Number.isFinite(stopPrice)) {
      throw new Error("Stop orders require a stop price.");
    }

    const beforePositionState = new Set(beforeSnapshot.positions.map(serializePosition));
    const beforeOrderState = new Set(beforeSnapshot.orders.map(serializeOrder));
    const beforeSnapshotState = serializeSnapshot(beforeSnapshot);
    const expectedDirection = side === "SELL" ? "Sell" : "Buy";
    const desiredPrice =
      orderType === "LIMIT" ? limitPrice : orderType === "STOP" ? stopPrice : undefined;
    const requestId = crypto.randomUUID();

    const execution = await this.waitForTradeResult(
      session,
      () => session.connection.sendCommand("ProtoOANewOrderReq", payload, requestId),
      {
        matchExecution: (eventPayload) =>
          eventMatchesSymbol(eventPayload, session.config.symbolId) &&
          eventMatchesTradeSide(eventPayload, side),
        matchError: (eventPayload) => eventMatchesSymbol(eventPayload, session.config.symbolId),
        matchProtocolError: (eventPayload) => eventPayload?.clientMsgId === requestId,
        confirmSnapshot: (snapshot) => {
          if (serializeSnapshot(snapshot) !== beforeSnapshotState) {
            return true;
          }

          if (orderType === "MARKET") {
            return snapshot.positions.some((position) => {
              if (position.direction !== expectedDirection) return false;
              return !beforePositionState.has(serializePosition(position));
            });
          }

          return snapshot.orders.some((order) => {
            if (order.direction !== expectedDirection) return false;
            if (!String(order.orderType ?? "").toUpperCase().includes(orderType)) return false;
            if (beforeOrderState.has(serializeOrder(order))) return false;

            const priceToCheck = orderType === "LIMIT" ? order.limitPrice : order.stopPrice;
            if (Number.isFinite(desiredPrice) && Number.isFinite(priceToCheck)) {
              return pricesRoughlyMatch(desiredPrice, priceToCheck);
            }

            return true;
          });
        },
      }
    );

    const snapshot = await this.publishTradeSnapshot(session, await this.getPositionsSnapshot(sessionId));
    return {
      execution: sanitizeExecutionEvent(execution),
      ...snapshot,
    };
  }

  async amendPosition(sessionId, request) {
    const session = this.getSessionById(sessionId);
    if (!session?.connection) {
      throw new Error("Live session is not available for position changes.");
    }

    const beforeSnapshot = await this.getPositionsSnapshot(sessionId);

    const positionId = toNumber(request?.positionId);
    const hasStopLoss = Object.prototype.hasOwnProperty.call(request ?? {}, "stopLoss");
    const hasTakeProfit = Object.prototype.hasOwnProperty.call(request ?? {}, "takeProfit");
    const stopLoss =
      hasStopLoss && request?.stopLoss === null
        ? null
        : normalizePriceForSymbol(toNumber(request?.stopLoss), session.config.symbolMeta);
    const takeProfit =
      hasTakeProfit && request?.takeProfit === null
        ? null
        : normalizePriceForSymbol(toNumber(request?.takeProfit), session.config.symbolMeta);
    const trailingStopLoss =
      typeof request?.trailingStopLoss === "boolean" ? request.trailingStopLoss : undefined;

    if (!positionId) {
      throw new Error("Position id is required.");
    }

    const payload = {
      ctidTraderAccountId: session.config.accountId,
      positionId,
      ...(hasStopLoss ? { stopLoss } : {}),
      ...(hasTakeProfit ? { takeProfit } : {}),
      ...(typeof trailingStopLoss === "boolean" ? { trailingStopLoss } : {}),
    };
    const requestId = crypto.randomUUID();

    const targetBefore = beforeSnapshot.positions.find(
      (position) => Number(position.positionId) === positionId
    );
    const preservedStopLoss = Number.isFinite(targetBefore?.stopLoss)
      ? normalizePriceForSymbol(targetBefore.stopLoss, session.config.symbolMeta)
      : null;
    const preservedTakeProfit = Number.isFinite(targetBefore?.takeProfit)
      ? normalizePriceForSymbol(targetBefore.takeProfit, session.config.symbolMeta)
      : null;
    const execution = await this.waitForTradeResult(
      session,
      () =>
        session.connection.sendCommand(
          "ProtoOAAmendPositionSLTPReq",
          {
            ...payload,
            ...((hasStopLoss || hasTakeProfit)
              ? {
                  stopLoss: hasStopLoss ? stopLoss : preservedStopLoss,
                  takeProfit: hasTakeProfit ? takeProfit : preservedTakeProfit,
                }
              : {}),
          },
          requestId
        ),
      {
        matchExecution: (eventPayload) =>
          eventMatchesSymbol(eventPayload, session.config.symbolId) &&
          eventMatchesPositionId(eventPayload, positionId),
        matchError: (eventPayload) =>
          eventMatchesSymbol(eventPayload, session.config.symbolId) &&
          eventMatchesPositionId(eventPayload, positionId),
        matchProtocolError: (eventPayload) => eventPayload?.clientMsgId === requestId,
        confirmSnapshot: (snapshot) => {
          const target = snapshot.positions.find(
            (position) => Number(position.positionId) === positionId
          );
          if (!target) return false;

          const stopLossMatches =
            !hasStopLoss ||
            (stopLoss === null
              ? !Number.isFinite(target.stopLoss)
              : Number.isFinite(target.stopLoss) && pricesRoughlyMatch(target.stopLoss, stopLoss));
          const takeProfitMatches =
            !hasTakeProfit ||
            (takeProfit === null
              ? !Number.isFinite(target.takeProfit)
              : Number.isFinite(target.takeProfit) &&
                pricesRoughlyMatch(target.takeProfit, takeProfit));

          if (!targetBefore) {
            return stopLossMatches && takeProfitMatches;
          }

          const stopLossChanged = hasStopLoss
            ? stopLoss === null
              ? Number.isFinite(targetBefore.stopLoss) && !Number.isFinite(target.stopLoss)
              : !optionalPricesEqual(targetBefore.stopLoss, target.stopLoss)
            : false;
          const takeProfitChanged = hasTakeProfit
            ? takeProfit === null
              ? Number.isFinite(targetBefore.takeProfit) && !Number.isFinite(target.takeProfit)
              : !optionalPricesEqual(targetBefore.takeProfit, target.takeProfit)
            : false;

          return stopLossMatches && takeProfitMatches && (stopLossChanged || takeProfitChanged);
        },
      }
    );

    const snapshot = await this.publishTradeSnapshot(session, await this.getPositionsSnapshot(sessionId));
    return {
      execution: sanitizeExecutionEvent(execution),
      ...snapshot,
    };
  }

  async amendOrder(sessionId, request) {
    const session = this.getSessionById(sessionId);
    if (!session?.connection) {
      throw new Error("Live session is not available for order changes.");
    }

    const beforeSnapshot = await this.getPositionsSnapshot(sessionId);

    const orderId = toNumber(request?.orderId);
    const hasLimitPrice = Object.prototype.hasOwnProperty.call(request ?? {}, "limitPrice");
    const hasStopPrice = Object.prototype.hasOwnProperty.call(request ?? {}, "stopPrice");
    const hasStopLoss = Object.prototype.hasOwnProperty.call(request ?? {}, "stopLoss");
    const hasTakeProfit = Object.prototype.hasOwnProperty.call(request ?? {}, "takeProfit");
    const limitPrice =
      hasLimitPrice && request?.limitPrice === null
        ? null
        : normalizePriceForSymbol(toNumber(request?.limitPrice), session.config.symbolMeta);
    const stopPrice =
      hasStopPrice && request?.stopPrice === null
        ? null
        : normalizePriceForSymbol(toNumber(request?.stopPrice), session.config.symbolMeta);
    const stopLoss =
      hasStopLoss && request?.stopLoss === null
        ? null
        : normalizePriceForSymbol(toNumber(request?.stopLoss), session.config.symbolMeta);
    const takeProfit =
      hasTakeProfit && request?.takeProfit === null
        ? null
        : normalizePriceForSymbol(toNumber(request?.takeProfit), session.config.symbolMeta);

    if (!orderId) {
      throw new Error("Order id is required.");
    }

    const existingOrder = beforeSnapshot.orders.find((order) => Number(order.orderId) === orderId);
    if (!existingOrder) {
      throw new Error("Order not found.");
    }
    const preservedStopLoss = Number.isFinite(existingOrder.stopLoss)
      ? normalizePriceForSymbol(existingOrder.stopLoss, session.config.symbolMeta)
      : null;
    const preservedTakeProfit = Number.isFinite(existingOrder.takeProfit)
      ? normalizePriceForSymbol(existingOrder.takeProfit, session.config.symbolMeta)
      : null;

    const payload = {
      ctidTraderAccountId: session.config.accountId,
      orderId,
      ...(hasLimitPrice ? { limitPrice } : {}),
      ...(hasStopPrice ? { stopPrice } : {}),
      ...(hasStopLoss ? { stopLoss } : {}),
      ...(hasTakeProfit ? { takeProfit } : {}),
    };
    const requestId = crypto.randomUUID();

    const execution = await this.waitForTradeResult(
      session,
      () =>
        session.connection.sendCommand(
          "ProtoOAAmendOrderReq",
          {
            ...payload,
            ...((hasStopLoss || hasTakeProfit)
              ? {
                  stopLoss: hasStopLoss ? stopLoss : preservedStopLoss,
                  takeProfit: hasTakeProfit ? takeProfit : preservedTakeProfit,
                }
              : {}),
          },
          requestId
        ),
      {
        matchExecution: (eventPayload) =>
          eventMatchesSymbol(eventPayload, session.config.symbolId) &&
          (toNumber(eventPayload?.order?.orderId) === orderId ||
            toNumber(eventPayload?.deal?.orderId) === orderId),
        matchError: (eventPayload) =>
          eventMatchesSymbol(eventPayload, session.config.symbolId) &&
          toNumber(eventPayload?.orderId) === orderId,
        matchProtocolError: (eventPayload) => eventPayload?.clientMsgId === requestId,
        confirmSnapshot: (snapshot) => {
          const target = snapshot.orders.find((order) => Number(order.orderId) === orderId);
          if (!target) return false;

          const limitMatches =
            !hasLimitPrice ||
            (limitPrice === null
              ? !Number.isFinite(target.limitPrice)
              : Number.isFinite(target.limitPrice) && pricesRoughlyMatch(target.limitPrice, limitPrice));
          const stopMatches =
            !hasStopPrice ||
            (stopPrice === null
              ? !Number.isFinite(target.stopPrice)
              : Number.isFinite(target.stopPrice) && pricesRoughlyMatch(target.stopPrice, stopPrice));
          const stopLossMatches =
            !hasStopLoss ||
            (stopLoss === null
              ? !Number.isFinite(target.stopLoss)
              : Number.isFinite(target.stopLoss) && pricesRoughlyMatch(target.stopLoss, stopLoss));
          const takeProfitMatches =
            !hasTakeProfit ||
            (takeProfit === null
              ? !Number.isFinite(target.takeProfit)
              : Number.isFinite(target.takeProfit) && pricesRoughlyMatch(target.takeProfit, takeProfit));

          const changed =
            (hasLimitPrice &&
              (limitPrice === null
                ? Number.isFinite(existingOrder.limitPrice) && !Number.isFinite(target.limitPrice)
                : !optionalPricesEqual(existingOrder.limitPrice, target.limitPrice))) ||
            (hasStopPrice &&
              (stopPrice === null
                ? Number.isFinite(existingOrder.stopPrice) && !Number.isFinite(target.stopPrice)
                : !optionalPricesEqual(existingOrder.stopPrice, target.stopPrice))) ||
            (hasStopLoss &&
              (stopLoss === null
                ? Number.isFinite(existingOrder.stopLoss) && !Number.isFinite(target.stopLoss)
                : !optionalPricesEqual(existingOrder.stopLoss, target.stopLoss))) ||
            (hasTakeProfit &&
              (takeProfit === null
                ? Number.isFinite(existingOrder.takeProfit) && !Number.isFinite(target.takeProfit)
                : !optionalPricesEqual(existingOrder.takeProfit, target.takeProfit)));

          return changed && limitMatches && stopMatches && stopLossMatches && takeProfitMatches;
        },
      }
    );

    const snapshot = await this.publishTradeSnapshot(session, await this.getPositionsSnapshot(sessionId));
    return {
      execution: sanitizeExecutionEvent(execution),
      ...snapshot,
    };
  }

  async cancelOrder(sessionId, request) {
    const session = this.getSessionById(sessionId);
    if (!session?.connection) {
      throw new Error("Live session is not available for order cancellation.");
    }

    const beforeSnapshot = await this.getPositionsSnapshot(sessionId);
    const orderId = toNumber(request?.orderId);
    if (!orderId) {
      throw new Error("Order id is required.");
    }

    const existingOrder = beforeSnapshot.orders.find((order) => Number(order.orderId) === orderId);
    if (!existingOrder) {
      throw new Error("Order not found.");
    }

    const requestId = crypto.randomUUID();
    const execution = await this.waitForTradeResult(
      session,
      () =>
        session.connection.sendCommand(
          "ProtoOACancelOrderReq",
          {
            ctidTraderAccountId: session.config.accountId,
            orderId,
          },
          requestId
        ),
      {
        matchExecution: (eventPayload) =>
          eventMatchesSymbol(eventPayload, session.config.symbolId) &&
          (toNumber(eventPayload?.order?.orderId) === orderId ||
            toNumber(eventPayload?.deal?.orderId) === orderId),
        matchError: (eventPayload) =>
          eventMatchesSymbol(eventPayload, session.config.symbolId) &&
          toNumber(eventPayload?.orderId) === orderId,
        matchProtocolError: (eventPayload) => eventPayload?.clientMsgId === requestId,
        confirmSnapshot: (snapshot) =>
          !snapshot.orders.some((order) => Number(order.orderId) === orderId),
      }
    );

    const snapshot = await this.publishTradeSnapshot(session, await this.getPositionsSnapshot(sessionId));
    return {
      execution: sanitizeExecutionEvent(execution),
      ...snapshot,
    };
  }

  async closePosition(sessionId, request) {
    const session = this.getSessionById(sessionId);
    if (!session?.connection) {
      throw new Error("Live session is not available for closing positions.");
    }

    const snapshot = await this.getPositionsSnapshot(sessionId);
    const positionId = toNumber(request?.positionId);
    if (!positionId) {
      throw new Error("Position id is required.");
    }

    const existing = snapshot.positions.find((position) => Number(position.positionId) === positionId);
    if (!existing) {
      throw new Error("Position not found.");
    }

    const requestedLots = toNumber(request?.lots);
    const volume = Number.isFinite(requestedLots)
      ? lotsToVolume(requestedLots, session.config.symbol, session.config.symbolMeta)
      : existing.volume;
    const requestId = crypto.randomUUID();

    const execution = await this.waitForTradeResult(
      session,
      () =>
        session.connection.sendCommand("ProtoOAClosePositionReq", {
          ctidTraderAccountId: session.config.accountId,
          positionId,
          volume,
        }, requestId),
      {
        matchExecution: (eventPayload) =>
          eventMatchesSymbol(eventPayload, session.config.symbolId) &&
          eventMatchesPositionId(eventPayload, positionId),
        matchError: (eventPayload) =>
          eventMatchesSymbol(eventPayload, session.config.symbolId) &&
          eventMatchesPositionId(eventPayload, positionId),
        matchProtocolError: (eventPayload) => eventPayload?.clientMsgId === requestId,
        confirmSnapshot: (nextSnapshot) => {
          const nextPosition = nextSnapshot.positions.find(
            (position) => Number(position.positionId) === positionId
          );
          if (!nextPosition) return true;
          return nextPosition.volume < existing.volume;
        },
      }
    );

    const nextSnapshot = await this.publishTradeSnapshot(session, await this.getPositionsSnapshot(sessionId));
    return {
      execution: sanitizeExecutionEvent(execution),
      ...nextSnapshot,
    };
  }

  async getTicks(sessionId, from, to) {
    const session = this.getSessionById(sessionId);
    if (!session?.connection || !session.config.symbolId) {
      throw new Error("Live session is not available for tick lookup.");
    }

    const requestBase = {
      ctidTraderAccountId: session.config.accountId,
      symbolId: session.config.symbolId,
      fromTimestamp: from,
      toTimestamp: to,
    };

    const [bidResponse, askResponse] = await Promise.all([
      session.connection.sendCommand("ProtoOAGetTickDataReq", {
        ...requestBase,
        type: "BID",
      }),
      session.connection.sendCommand("ProtoOAGetTickDataReq", {
        ...requestBase,
        type: "ASK",
      }),
    ]);

    const referencePrice = getAnchorPriceFromPayload(session.latestPayload);
    return {
      symbol: session.config.symbol,
      timeframe: session.config.timeframe,
      bidTicks: mapTickSeries(bidResponse?.tickData, {
        symbol: session.config.symbol,
        anchorPrice: referencePrice,
      }),
      askTicks: mapTickSeries(askResponse?.tickData, {
        symbol: session.config.symbol,
        anchorPrice: referencePrice,
      }),
    };
  }

  async createOrReuse(config) {
    const key = this.buildKey(config);
    const existingId = this.sessionsByKey.get(key);
    const existing = existingId ? this.sessions.get(existingId) : null;
    if (existing) {
      if (existing.state === "error") {
        await this.disposeSession(existing.id);
      } else {
        if (typeof config.supabaseAccessToken === "string" && config.supabaseAccessToken.trim()) {
          existing.supabaseAccessToken = config.supabaseAccessToken.trim();
        }
        if (typeof config.userId === "string" && config.userId.trim()) {
          existing.userId = config.userId.trim();
        }
        existing.lastTouchedAt = Date.now();
        return existing;
      }
    }

    const session = {
      id: crypto.randomUUID(),
      key,
      config,
      state: "connecting",
      latestPayload: null,
      latestTradeSnapshot: null,
      latestTradeSnapshotHash: "",
      error: null,
      subscribers: new Set(),
      heartbeatTimer: null,
      cleanupTimer: null,
      connection: null,
      listenerId: null,
      executionListenerId: null,
      alerts: [],
      supabaseAccessToken:
        typeof config.supabaseAccessToken === "string" ? config.supabaseAccessToken : "",
      userId: typeof config.userId === "string" ? config.userId : "",
      lastTouchedAt: Date.now(),
    };

    this.sessions.set(session.id, session);
    this.sessionsByKey.set(key, session.id);

    try {
      await this.startSession(session);
      return session;
    } catch (error) {
      session.state = "error";
      session.error = error instanceof Error ? error.message : String(error);
      return session;
    }
  }

  async startSession(session) {
    const require = createRequire(import.meta.url);
    const { CTraderConnection } = require("@reiryoku/ctrader-layer");
    const connection = new CTraderConnection({
      host: session.config.host,
      port: protoPort,
    });

    await connection.open();
    await connection.sendCommand("ProtoOAApplicationAuthReq", {
      clientId,
      clientSecret,
    });
    await connection.sendCommand("ProtoOAAccountAuthReq", {
      ctidTraderAccountId: session.config.accountId,
      accessToken: session.config.accessToken,
    });

    const symbolsRes = await connection.sendCommand("ProtoOASymbolsListReq", {
      ctidTraderAccountId: session.config.accountId,
    });
    const symbols = Array.isArray(symbolsRes?.symbol) ? symbolsRes.symbol : [];
    session.config.symbolDirectory = new Map(
      symbols
        .map((item) => {
          const itemSymbolId = toNumber(item?.symbolId ?? item?.id);
          if (!itemSymbolId) return null;
          return [
            itemSymbolId,
            {
              symbol: normalizeSymbol(item?.symbolName ?? item?.name) || String(itemSymbolId),
              symbolMeta: buildSymbolMetaSnapshot(item),
            },
          ];
        })
        .filter(Boolean)
    );
    const normalizedSymbol = normalizeSymbol(session.config.symbol);
    const symbolRow = symbols.find((item) => {
      const name = normalizeSymbol(item?.symbolName ?? item?.name);
      return name === normalizedSymbol;
    });

    const symbolId = toNumber(symbolRow?.symbolId ?? symbolRow?.id);
    if (!symbolId) {
      throw new Error(`Symbol not found for live session: ${session.config.symbol}`);
    }

    session.config.symbolId = symbolId;
    const symbolDetailsRes = await connection.sendCommand("ProtoOASymbolByIdReq", {
      ctidTraderAccountId: session.config.accountId,
      symbolId: [symbolId],
    });
    const fullSymbol =
      Array.isArray(symbolDetailsRes?.symbol) &&
      symbolDetailsRes.symbol.find((item) => toNumber(item?.symbolId) === symbolId);
    session.config.symbolMeta = fullSymbol
      ? {
          lotSize: toNumber(fullSymbol?.lotSize),
          minVolume: toNumber(fullSymbol?.minVolume),
          maxVolume: toNumber(fullSymbol?.maxVolume),
          stepVolume: toNumber(fullSymbol?.stepVolume),
          digits: toNumber(fullSymbol?.digits),
        }
      : null;
    session.config.symbolDirectory?.set(symbolId, {
      symbol: normalizedSymbol,
      symbolMeta: session.config.symbolMeta,
    });

    const period = trendbarMap[session.config.timeframe.toUpperCase()];
    if (!period) {
      throw new Error(`Unsupported timeframe: ${session.config.timeframe}`);
    }

    const handleSpotEvent = (event) => {
      const payload = event?.descriptor ?? event ?? {};
      const eventSymbolId = toNumber(payload?.symbolId);
      if (eventSymbolId !== symbolId) return;

      const referencePrice = getAnchorPriceFromPayload(session.latestPayload);
      const bid = sanitizeLivePrice(
        normalizePrice(payload?.bid),
        session.config.symbol,
        referencePrice
      );
      const ask = sanitizeLivePrice(
        normalizePrice(payload?.ask),
        session.config.symbol,
        bid ?? referencePrice
      );
      const currentBar = Array.isArray(payload?.trendbar)
        ? sanitizeTrendbar(
            mapTrendbar(payload.trendbar[0]),
            session.config.symbol,
            bid ?? ask ?? referencePrice
          )
        : null;
      if (bid === undefined && ask === undefined && !currentBar) {
        return;
      }

      const nextPayload = {
        type: "price",
        symbol: session.config.symbol,
        timeframe: session.config.timeframe,
        bid,
        ask,
        currentBar,
        spotTimestamp: toNumber(payload?.timestamp) ?? Date.now(),
      };

      session.latestPayload = nextPayload;
      session.state = "live";
      session.error = null;
      session.lastTouchedAt = Date.now();
      this.broadcast(session, nextPayload);
      void this.evaluateAlerts(session, nextPayload).catch((error) => {
        console.warn("[ctrader-live-service] Failed to evaluate alerts:", error);
      });
    };

    const handleExecutionEvent = (event) => {
      const payload = event?.descriptor ?? event ?? {};
      if (!eventMatchesSymbol(payload, symbolId)) {
        return;
      }

      session.lastTouchedAt = Date.now();
      void this.publishTradeSnapshot(session).catch(() => {
        // Ignore transient snapshot reconcile failures; the next trade event will retry.
      });
    };

    session.listenerId = connection.on("ProtoOASpotEvent", handleSpotEvent);
    session.executionListenerId = connection.on("ProtoOAExecutionEvent", handleExecutionEvent);

    await connection.sendCommand("ProtoOASubscribeSpotsReq", {
      ctidTraderAccountId: session.config.accountId,
      symbolId: [symbolId],
      subscribeToSpotTimestamp: true,
    });

    await connection.sendCommand("ProtoOASubscribeLiveTrendbarReq", {
      ctidTraderAccountId: session.config.accountId,
      period,
      symbolId,
    });

    session.connection = connection;
    session.state = "live";
    session.error = null;
    await this.publishTradeSnapshot(session, null, true).catch(() => null);
    session.heartbeatTimer = setInterval(() => {
      try {
        connection.sendHeartbeat();
      } catch {
        // Ignore heartbeat failures; the next reconnect attempt will surface the issue.
      }
    }, HEARTBEAT_MS);
  }

  broadcast(session, payload) {
    for (const response of session.subscribers) {
      writeSse(response, "message", payload);
    }
  }

  async publishTradeSnapshot(session, snapshot = null, force = false) {
    if (!session) {
      return null;
    }

    const resolvedSnapshot = snapshot ?? (await this.getPositionsSnapshot(session.id));
    const snapshotHash = serializeSnapshot(resolvedSnapshot);

    if (!force && snapshotHash === session.latestTradeSnapshotHash) {
      return resolvedSnapshot;
    }

    const payload = {
      type: "snapshot",
      symbol: session.config.symbol,
      timeframe: session.config.timeframe,
      positions: resolvedSnapshot.positions,
      orders: resolvedSnapshot.orders,
    };

    session.latestTradeSnapshot = payload;
    session.latestTradeSnapshotHash = snapshotHash;
    session.lastTouchedAt = Date.now();
    this.broadcast(session, payload);
    return resolvedSnapshot;
  }

  syncAlerts(sessionId, body) {
    const session = this.getSessionById(sessionId);
    if (!session) {
      throw new Error("Live session not found.");
    }

    session.userId =
      typeof body.userId === "string" && body.userId.trim()
        ? body.userId.trim()
        : session.userId;
    session.supabaseAccessToken =
      typeof body.supabaseAccessToken === "string" && body.supabaseAccessToken.trim()
        ? body.supabaseAccessToken.trim()
        : session.supabaseAccessToken;

    const nextAlerts = Array.isArray(body.alerts)
      ? body.alerts
          .map((alert) => sanitizePriceAlert(alert))
          .filter((alert) => alert && alert.isActive)
          .filter((alert) => alert.symbol === normalizeSymbol(session.config.symbol))
      : [];

    session.alerts = nextAlerts;
    session.lastTouchedAt = Date.now();
    if (session.latestPayload) {
      void this.evaluateAlerts(session, session.latestPayload).catch((error) => {
        console.warn("[ctrader-live-service] Failed to evaluate alerts after sync:", error);
      });
    }

    return {
      ok: true,
      count: session.alerts.length,
    };
  }

  async persistAlertTrigger(session, alert, triggerPrice, firedAtIso) {
    const supabase = buildSupabaseUserClient(session.supabaseAccessToken);
    if (!supabase || !session.userId) {
      return;
    }

    const [eventResult, alertResult] = await Promise.all([
      supabase.from("price_alert_events").insert({
        alert_id: alert.id,
        user_id: session.userId,
        broker: alert.broker,
        symbol: alert.symbol,
        condition: alert.condition,
        price_side: alert.priceSide,
        target_price: alert.targetPrice,
        trigger_price: triggerPrice,
        note: alert.note,
        fired_at: firedAtIso,
        created_at: firedAtIso,
      }),
      supabase
        .from("price_alerts")
        .update({
          is_active: false,
          last_triggered_at: firedAtIso,
          updated_at: firedAtIso,
        })
        .eq("user_id", session.userId)
        .eq("id", alert.id),
    ]);

    if (eventResult.error) {
      throw eventResult.error;
    }
    if (alertResult.error) {
      throw alertResult.error;
    }
  }

  async evaluateAlerts(session, payload) {
    if (!session || !Array.isArray(session.alerts) || session.alerts.length === 0) {
      return;
    }

    const bid = toNumber(payload?.bid);
    const ask = toNumber(payload?.ask);
    const nextAlerts = [];

    for (const alert of session.alerts) {
      if (!alert?.isActive) {
        continue;
      }

      const markPrice = alert.priceSide === "ask" ? ask : bid;
      if (!Number.isFinite(markPrice)) {
        nextAlerts.push(alert);
        continue;
      }

      const shouldTrigger =
        alert.condition === "below"
          ? markPrice <= alert.targetPrice
          : markPrice >= alert.targetPrice;

      if (!shouldTrigger) {
        nextAlerts.push(alert);
        continue;
      }

      const firedAtIso = new Date().toISOString();
      const eventPayload = {
        type: "alert-fired",
        event: {
          id: crypto.randomUUID(),
          alertId: alert.id,
          broker: alert.broker,
          symbol: alert.symbol,
          condition: alert.condition,
          priceSide: alert.priceSide,
          targetPrice: alert.targetPrice,
          triggerPrice: markPrice,
          note: alert.note,
          firedAt: firedAtIso,
        },
      };

      this.broadcast(session, eventPayload);
      void this.persistAlertTrigger(session, alert, markPrice, firedAtIso).catch((error) => {
        console.warn("[ctrader-live-service] Failed to persist alert trigger:", error);
      });
    }

    session.alerts = nextAlerts;
  }

  attachSubscriber(session, response) {
    session.lastTouchedAt = Date.now();
    if (session.cleanupTimer) {
      clearTimeout(session.cleanupTimer);
      session.cleanupTimer = null;
    }

    session.subscribers.add(response);
    const keepAliveTimer = setInterval(() => {
      response.write(": keepalive\n\n");
    }, KEEPALIVE_MS);
    response.__keepAliveTimer = keepAliveTimer;

    writeSse(response, "status", {
      sessionId: session.id,
      state: session.state,
      error: session.error,
    });

    if (session.latestPayload) {
      writeSse(response, "message", session.latestPayload);
    }
    if (session.latestTradeSnapshot) {
      writeSse(response, "message", session.latestTradeSnapshot);
    }
  }

  detachSubscriber(session, response) {
    session.subscribers.delete(response);
    if (response.__keepAliveTimer) {
      clearInterval(response.__keepAliveTimer);
      response.__keepAliveTimer = null;
    }

    if (session.subscribers.size === 0) {
      session.cleanupTimer = setTimeout(() => {
        this.disposeSession(session.id);
      }, SESSION_TTL_MS);
    }
  }

  async disposeSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    this.sessions.delete(sessionId);
    if (this.sessionsByKey.get(session.key) === sessionId) {
      this.sessionsByKey.delete(session.key);
    }

    if (session.heartbeatTimer) clearInterval(session.heartbeatTimer);
    if (session.cleanupTimer) clearTimeout(session.cleanupTimer);

    if (session.connection) {
      try {
        if (session.listenerId) {
          session.connection.removeEventListener(session.listenerId);
        }
        if (session.executionListenerId) {
          session.connection.removeEventListener(session.executionListenerId);
        }
      } catch {
        // ignore
      }

      try {
        if (session.config.symbolId) {
          const period = trendbarMap[session.config.timeframe.toUpperCase()];
          if (period) {
            await session.connection.sendCommand("ProtoOAUnsubscribeLiveTrendbarReq", {
              ctidTraderAccountId: session.config.accountId,
              period,
              symbolId: session.config.symbolId,
            }).catch(() => {});
          }
          await session.connection.sendCommand("ProtoOAUnsubscribeSpotsReq", {
            ctidTraderAccountId: session.config.accountId,
            symbolId: [session.config.symbolId],
          }).catch(() => {});
        }
      } catch {
        // ignore
      }

      try {
        session.connection.close();
      } catch {
        // ignore
      }
    }
  }
}

async function resolveLiveConfig(body) {
  const accessToken = typeof body.accessToken === "string" ? body.accessToken.trim() : "";
  const symbol = typeof body.symbol === "string" ? body.symbol.trim() : "";
  const timeframe = typeof body.timeframe === "string" ? body.timeframe.trim().toUpperCase() : "";
  const requestedAccountNumber =
    body.accountNumber != null ? String(body.accountNumber).trim() : "";
  const requestedAccountId = toNumber(body.accountId);

  if (!accessToken || !symbol || !timeframe) {
    throw new Error("Missing accessToken, symbol, or timeframe.");
  }

  if (!clientId || !clientSecret) {
    throw new Error("Missing cTrader client credentials.");
  }

  const accounts = await fetchAccounts(accessToken);
  let account = null;
  if (requestedAccountId !== undefined) {
    account = accounts.find((item) => getAccountNumericId(item) === requestedAccountId) ?? null;
    if (!account) {
      throw new Error(`Requested cTrader account id ${requestedAccountId} was not found for this token.`);
    }
  } else if (requestedAccountNumber) {
    account =
      accounts.find((item) => {
        const identifier = getAccountIdentifier(item);
        const accountIdString = String(getAccountNumericId(item));
        return identifier === requestedAccountNumber || accountIdString === requestedAccountNumber;
      }) ?? null;
    if (!account) {
      throw new Error(`Requested cTrader account ${requestedAccountNumber} was not found for this token.`);
    }
  } else {
    account = accounts[0] ?? null;
  }

  const accountId = getAccountNumericId(account);
  if (!accountId) {
    throw new Error("Could not resolve a cTrader account for the live session.");
  }

  return {
    accessToken,
    symbol,
    timeframe,
    accountId,
    accountNumber: requestedAccountNumber || getAccountIdentifier(account),
    host: getAccountHost(account),
    symbolId: null,
    supabaseAccessToken:
      typeof body.supabaseAccessToken === "string" ? body.supabaseAccessToken.trim() : "",
    userId: typeof body.userId === "string" ? body.userId.trim() : "",
  };
}

const sessionManager = new LiveSessionManager();

export function startCTraderLiveService(options = {}) {
  const host = options.host || process.env.CTRADER_LIVE_SERVICE_HOST || "127.0.0.1";
  const port = Number(
    options.port || process.env.CTRADER_LIVE_SERVICE_PORT || process.env.PORT || 47832
  );

  const server = http.createServer(async (request, response) => {
    const origin = request.headers.origin;

    if (!request.url) {
      writeJson(response, 400, { error: "Missing request URL." }, origin);
      return;
    }

    if (request.method === "OPTIONS") {
      response.writeHead(204, buildCorsHeaders(origin));
      response.end();
      return;
    }

    try {
      const url = new URL(request.url, `http://${request.headers.host ?? `${host}:${port}`}`);
      const pathname = url.pathname;

      if (pathname === "/health") {
        writeJson(
          response,
          200,
          {
            ok: true,
            service: "ctrader-live-service",
          },
          origin
        );
        return;
      }

      if (pathname === "/api/ctrader/live/session" && request.method === "POST") {
        const body = await readJsonBody(request);
        const config = await resolveLiveConfig(body);
        const session = await sessionManager.createOrReuse(config);
        writeJson(
          response,
          200,
          {
            sessionId: session.id,
            state: session.state,
            error: session.error,
            snapshot: session.latestPayload,
          },
          origin
        );
        return;
      }

      if (pathname === "/api/ctrader/live/session" && request.method === "DELETE") {
        const sessionId = url.searchParams.get("sessionId") ?? "";
        if (!sessionId) {
          writeJson(response, 400, { error: "Missing sessionId." }, origin);
          return;
        }
        await sessionManager.disposeSession(sessionId);
        writeJson(response, 200, { ok: true }, origin);
        return;
      }

      if (pathname === "/api/ctrader/live/stream" && request.method === "GET") {
        const sessionId = url.searchParams.get("sessionId") ?? "";
        const session = sessionManager.getSessionById(sessionId);
        if (!session) {
          writeJson(response, 404, { error: "Live session not found." }, origin);
          return;
        }

        response.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          ...buildCorsHeaders(origin),
        });
        response.write("\n");
        sessionManager.attachSubscriber(session, response);

        request.on("close", () => {
          sessionManager.detachSubscriber(session, response);
        });
        return;
      }

      if (pathname === "/api/ctrader/live/ticks" && request.method === "GET") {
        const sessionId = url.searchParams.get("sessionId") ?? "";
        const from = Number(url.searchParams.get("from"));
        const to = Number(url.searchParams.get("to"));

        if (!sessionId || !Number.isFinite(from) || !Number.isFinite(to)) {
          writeJson(response, 400, { error: "Missing sessionId or invalid from/to." }, origin);
          return;
        }

        const ticks = await sessionManager.getTicks(sessionId, from, to);
        writeJson(response, 200, ticks, origin);
        return;
      }

      if (pathname === "/api/ctrader/live/positions" && request.method === "GET") {
        const sessionId = url.searchParams.get("sessionId") ?? "";
        if (!sessionId) {
          writeJson(response, 400, { error: "Missing sessionId." }, origin);
          return;
        }

        const snapshot = await sessionManager.getPositionsSnapshot(sessionId);
        writeJson(response, 200, snapshot, origin);
        return;
      }

      if (pathname === "/api/ctrader/live/alerts/sync" && request.method === "POST") {
        const body = await readJsonBody(request);
        const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
        if (!sessionId) {
          writeJson(response, 400, { error: "Missing sessionId." }, origin);
          return;
        }

        const result = sessionManager.syncAlerts(sessionId, body);
        writeJson(response, 200, result, origin);
        return;
      }

      if (pathname === "/api/ctrader/live/orders" && request.method === "POST") {
        const body = await readJsonBody(request);
        const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
        if (!sessionId) {
          writeJson(response, 400, { error: "Missing sessionId." }, origin);
          return;
        }

        const result = await sessionManager.placeOrder(sessionId, body);
        writeJson(response, 200, result, origin);
        return;
      }

      if (pathname === "/api/ctrader/live/orders/amend" && request.method === "POST") {
        const body = await readJsonBody(request);
        const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
        if (!sessionId) {
          writeJson(response, 400, { error: "Missing sessionId." }, origin);
          return;
        }

        const result = await sessionManager.amendOrder(sessionId, body);
        writeJson(response, 200, result, origin);
        return;
      }

      if (pathname === "/api/ctrader/live/orders/cancel" && request.method === "POST") {
        const body = await readJsonBody(request);
        const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
        if (!sessionId) {
          writeJson(response, 400, { error: "Missing sessionId." }, origin);
          return;
        }

        const result = await sessionManager.cancelOrder(sessionId, body);
        writeJson(response, 200, result, origin);
        return;
      }

      if (pathname === "/api/ctrader/live/positions/amend" && request.method === "POST") {
        const body = await readJsonBody(request);
        const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
        if (!sessionId) {
          writeJson(response, 400, { error: "Missing sessionId." }, origin);
          return;
        }

        const result = await sessionManager.amendPosition(sessionId, body);
        writeJson(response, 200, result, origin);
        return;
      }

      if (pathname === "/api/ctrader/live/positions/close" && request.method === "POST") {
        const body = await readJsonBody(request);
        const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
        if (!sessionId) {
          writeJson(response, 400, { error: "Missing sessionId." }, origin);
          return;
        }

        const result = await sessionManager.closePosition(sessionId, body);
        writeJson(response, 200, result, origin);
        return;
      }

      writeJson(response, 404, { error: "Not found." }, origin);
    } catch (error) {
      writeJson(
        response,
        500,
        {
          error: normalizeServiceErrorMessage(error),
        },
        origin
      );
    }
  });

  server.listen(port, host, () => {
    console.log(`cTrader live service listening on http://${host}:${port}`);
  });

  return server;
}

if (process.argv[1]?.endsWith("server.mjs")) {
  startCTraderLiveService();
}
