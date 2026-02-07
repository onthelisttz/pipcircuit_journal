import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { createRequire } from "module";
import { estimateGrossProfit, volumeToLots } from "@lib/pnl-estimate";

export const runtime = "nodejs";

const clientId = process.env.NEXT_PUBLIC_CTRADER_CLIENT_ID ?? "";
const clientSecret = process.env.CTRADER_CLIENT_SECRET ?? "";
const protoLiveHost = process.env.CTRADER_PROTO_HOST_LIVE ?? "live.ctraderapi.com";
const protoDemoHost = process.env.CTRADER_PROTO_HOST_DEMO ?? "demo.ctraderapi.com";
const protoPort = Number(process.env.CTRADER_PROTO_PORT ?? "5035");

type TradeRecord = {
  ticketId: string;
  orderId: string;
  positionId: string;
  symbol: string;
  direction: string;
  orderType: string;
  dealStatus: string;
  openTime: string;
  closeTime: string;
  createTimestamp: string;
  executionTimestamp: string;
  openPrice: string;
  closePrice: string;
  entryPrice: string;
  volume: string;
  filledVolume: string;
  commission: string;
  swap: string;
  fee: string;
  grossProfit: string;
  netProfit: string;
  percentGain: string;
};

async function ensureProtoFiles(): Promise<void> {
  const packageRoot = path.join(
    process.cwd(),
    "node_modules",
    "@reiryoku",
    "ctrader-layer"
  );
  const sourceDir = path.join(packageRoot, "protobuf");
  const targetDir = path.join(packageRoot, "build", "protobuf");
  await fs.mkdir(targetDir, { recursive: true });
  const files = await fs.readdir(sourceDir);
  await Promise.all(
    files
      .filter((file) => file.endsWith(".proto"))
      .map((file) => fs.copyFile(path.join(sourceDir, file), path.join(targetDir, file)))
  );
}

async function fetchAccounts(accessToken: string) {
  const response = await fetch(
    `https://api.spotware.com/connect/tradingaccounts?access_token=${encodeURIComponent(
      accessToken
    )}`,
    {
      method: "GET",
      headers: { Accept: "application/json" },
    }
  );
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (Array.isArray(parsed)) {
    return parsed as Record<string, unknown>[];
  }
  if (parsed && typeof parsed === "object") {
    const record = parsed as Record<string, unknown>;
    const candidates = [
      record["accounts"],
      record["tradingAccounts"],
      record["accountList"],
      record["data"],
    ];
    for (const candidate of candidates) {
      if (Array.isArray(candidate)) {
        return candidate as Record<string, unknown>[];
      }
    }
  }
  return [];
}

function getAccountHost(account: Record<string, unknown> | undefined): string {
  const live =
    typeof account?.["live"] === "boolean"
      ? account?.["live"]
      : typeof account?.["isLive"] === "boolean"
        ? account?.["isLive"]
        : undefined;
  return live ? protoLiveHost : protoDemoHost;
}

async function getAssetMap(
  connection: any,
  accountId: number
): Promise<Map<number, string>> {
  const res = await connection.sendCommand("ProtoOAAssetListReq", {
    ctidTraderAccountId: accountId,
  });
  const candidate = (res?.asset as unknown) ?? (res?.assets as unknown) ?? [];
  const assets = (Array.isArray(candidate) ? candidate : []) as Array<Record<string, unknown>>;
  const map = new Map<number, string>();
  for (const a of assets) {
    const id = toNumber(a["assetId"] ?? a["id"]);
    const name = typeof a["name"] === "string" ? a["name"] : undefined;
    if (id !== undefined && name) {
      map.set(id, name);
    }
  }
  return map;
}

async function getSymbolMap(
  connection: any,
  accountId: number
): Promise<Map<number, string>> {
  const [symbolsRes, assetMap] = await Promise.all([
    connection.sendCommand("ProtoOASymbolsListReq", {
      ctidTraderAccountId: accountId,
      includeArchivedSymbols: true,
    }),
    getAssetMap(connection, accountId),
  ]);
  const map = new Map<number, string>();

  // ProtoOALightSymbol: symbolId, symbolName (optional), baseAssetId, quoteAssetId
  const symbolsCandidate =
    (symbolsRes?.symbol as unknown) ??
    (symbolsRes?.symbols as unknown) ??
    (symbolsRes?.symbolList as unknown) ??
    [];
  const symbols = (Array.isArray(symbolsCandidate) ? symbolsCandidate : []) as Array<
    Record<string, unknown>
  >;
  for (const symbol of symbols) {
    const symbolId = toNumber(symbol["symbolId"] ?? symbol["id"]);
    if (symbolId === undefined) continue;
    let symbolName =
      typeof symbol["symbolName"] === "string"
        ? symbol["symbolName"]
        : typeof symbol["name"] === "string"
          ? symbol["name"]
          : undefined;
    if (!symbolName && assetMap.size > 0) {
      const baseId = toNumber(symbol["baseAssetId"] ?? symbol["baseAsset"]);
      const quoteId = toNumber(symbol["quoteAssetId"] ?? symbol["quoteAsset"]);
      const base = baseId !== undefined ? assetMap.get(baseId) : undefined;
      const quote = quoteId !== undefined ? assetMap.get(quoteId) : undefined;
      if (base && quote) {
        symbolName = `${base}/${quote}`;
      }
    }
    if (symbolName) {
      map.set(symbolId, symbolName);
    }
  }

  // ProtoOAArchivedSymbol: symbolId, name (archived symbols)
  const archivedCandidate =
    (symbolsRes?.archivedSymbol as unknown) ??
    (symbolsRes?.archivedSymbols as unknown) ??
    [];
  const archived = (Array.isArray(archivedCandidate) ? archivedCandidate : []) as Array<
    Record<string, unknown>
  >;
  for (const sym of archived) {
    const symbolId = toNumber(sym["symbolId"] ?? sym["id"]);
    const name = typeof sym["name"] === "string" ? sym["name"] : undefined;
    if (symbolId !== undefined && name && !map.has(symbolId)) {
      map.set(symbolId, name);
    }
  }

  return map;
}

function toNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  // protobuf int64 may be Long-like { low, high, toString }
  if (v && typeof v === "object" && "toString" in v) {
    const n = Number((v as { toString(): string }).toString());
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

async function getSymbolNamesById(
  connection: any,
  accountId: number,
  symbolIds: number[]
): Promise<Map<number, string>> {
  if (symbolIds.length === 0) {
    return new Map();
  }
  const res = await connection.sendCommand("ProtoOASymbolByIdReq", {
    ctidTraderAccountId: accountId,
    symbolId: symbolIds,
  });
  const map = new Map<number, string>();

  // ProtoOASymbolByIdRes.symbol = ProtoOASymbol (no symbolName - skip for names)
  // ProtoOASymbolByIdRes.archivedSymbol = ProtoOAArchivedSymbol (has symbolId, name)
  const archivedCandidate =
    (res?.archivedSymbol as unknown) ??
    (res?.archivedSymbols as unknown) ??
    [];
  const archived = (Array.isArray(archivedCandidate) ? archivedCandidate : []) as Array<
    Record<string, unknown>
  >;
  for (const sym of archived) {
    const symbolId = toNumber(sym["symbolId"] ?? sym["id"]);
    const name = typeof sym["name"] === "string" ? sym["name"] : undefined;
    if (symbolId !== undefined && name) {
      map.set(symbolId, name);
    }
  }

  return map;
}

function chunkRange(from: number, to: number, maxMs: number): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let cursor = from;
  while (cursor < to) {
    const end = Math.min(cursor + maxMs, to);
    ranges.push([cursor, end]);
    cursor = end;
  }
  return ranges;
}

function normalizeMoney(value?: number, digits = 2): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  return value / 10 ** digits;
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    accessToken?: string;
    accountNumber?: string;
    accountId?: number;
    from?: number;
    to?: number;
  };
  if (!body.accessToken) {
    return NextResponse.json({ error: "Missing access token" }, { status: 400 });
  }
  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: "Missing cTrader client credentials" }, { status: 500 });
  }

  try {
    await ensureProtoFiles();
    const accounts = await fetchAccounts(body.accessToken);
    const account =
      body.accountId !== undefined
        ? accounts.find((item) => Number(item["accountId"]) === body.accountId)
        : accounts.find(
            (item) =>
              String(item["accountNumber"]) === body.accountNumber ||
              String(item["accountId"]) === body.accountNumber
          ) ??
          accounts[0];
    const accountId = Number(
      account?.["accountId"] ?? account?.["ctidTraderAccountId"] ?? account?.["accountNumber"]
    );
    if (!accountId) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    const host = getAccountHost(account);
    const require = createRequire(import.meta.url);
    const { CTraderConnection } = require("@reiryoku/ctrader-layer") as {
      CTraderConnection: new (args: { host: string; port: number }) => any;
    };
    const connection = new CTraderConnection({ host, port: protoPort });

    try {
      await connection.open();
      await connection.sendCommand("ProtoOAApplicationAuthReq", {
        clientId,
        clientSecret,
      });
      await connection.sendCommand("ProtoOAAccountAuthReq", {
        ctidTraderAccountId: accountId,
        accessToken: body.accessToken,
      });

      const symbolMap = await getSymbolMap(connection, accountId);
      const now = Date.now();
      const from = body.from ?? now - 30 * 24 * 60 * 60 * 1000;
      const to = body.to ?? now;
      const ranges = chunkRange(from, to, 7 * 24 * 60 * 60 * 1000);

      // First pass: fetch all deals and build positionOpenTime from OPENING deals only.
      // Opening deals have no closePositionDetail. Closing deals may reference positions
      // opened in an earlier range, so we must process all ranges before building trades.
      const allDeals: Array<Record<string, unknown>>[] = [];
      const positionOpenTime = new Map<string, number>();
      for (const [start, end] of ranges) {
        const response = await connection.sendCommand("ProtoOADealListReq", {
          ctidTraderAccountId: accountId,
          fromTimestamp: start,
          toTimestamp: end,
          maxRows: 10000,
        });
        const deals = (response?.deal ?? response?.deals ?? []) as Array<Record<string, unknown>>;
        allDeals.push(deals);
        for (const deal of deals) {
          const close = deal["closePositionDetail"] as Record<string, unknown> | undefined;
          if (!close) {
            const posId = String(toNumber(deal["positionId"]) ?? deal["positionId"] ?? "");
            const execTs = Number(deal["executionTimestamp"]);
            if (posId && posId !== "undefined" && execTs && !positionOpenTime.has(posId)) {
              positionOpenTime.set(posId, execTs);
            }
          }
        }
      }

      const trades: TradeRecord[] = [];
      const symbolIds = new Set<number>();
      for (const deals of allDeals) {
        for (const deal of deals) {
          const symbolId = toNumber(deal["symbolId"]);
          if (symbolId !== undefined) {
            symbolIds.add(symbolId);
          }
          const dealSymbolName =
            typeof deal["symbolName"] === "string"
              ? (deal["symbolName"] as string)
              : typeof deal["symbol"] === "string"
                ? (deal["symbol"] as string)
                : undefined;
          const symbolName =
            dealSymbolName ??
            (symbolId !== undefined ? symbolMap.get(symbolId) : undefined) ??
            (symbolId !== undefined && symbolId > 0 ? String(symbolId) : "Unknown");
          const dealDigits = typeof deal["moneyDigits"] === "number" ? deal["moneyDigits"] : 2;
          const close = deal["closePositionDetail"] as Record<string, unknown> | undefined;
          const closeDigits =
            typeof close?.["moneyDigits"] === "number" ? close["moneyDigits"] : dealDigits;
          const entryPrice =
            typeof close?.["entryPrice"] === "number"
              ? close["entryPrice"]
              : Number(deal["executionPrice"]);

          let grossProfit: number | undefined;
          if (close) {
            const rawGross = toNumber(close["grossProfit"]);
            const apiGross =
              rawGross !== undefined
                ? normalizeMoney(rawGross, closeDigits)
                : undefined;
            if (apiGross !== undefined) {
              grossProfit = apiGross;
            } else {
              const execPrice = Number(deal["executionPrice"]);
              const rawVol = toNumber(deal["volume"]) ?? Number(deal["volume"]);
              const vol = volumeToLots(rawVol, symbolName);
              const closingSide = String(deal["tradeSide"]) === "SELL" ? "Sell" : "Buy";
              const openingSide = closingSide === "Sell" ? "Buy" : "Sell";
              grossProfit = estimateGrossProfit(
                entryPrice,
                execPrice,
                vol,
                openingSide,
                symbolName
              );
            }
          }
          const swap = normalizeMoney(toNumber(close?.["swap"]), closeDigits);
          const commission = normalizeMoney(
            toNumber(close?.["commission"]) ?? toNumber(deal["commission"]),
            closeDigits
          );
          const fee = normalizeMoney(toNumber(close?.["pnlConversionFee"]), closeDigits);
          const netProfit =
            grossProfit !== undefined
              ? grossProfit + (commission ?? 0) + (swap ?? 0) + (fee ?? 0)
              : undefined;
          const execTs = Number(deal["executionTimestamp"]);
          const createTs = Number(deal["createTimestamp"] ?? execTs);
          const posId = String(toNumber(deal["positionId"]) ?? deal["positionId"] ?? "");
          const openTs = close
            ? (positionOpenTime.get(posId) ?? execTs)
            : execTs;

          const str = (v: unknown): string =>
            v === undefined || v === null ? "" : String(v);
          const numStr = (n: number | undefined): string =>
            n === undefined ? "" : String(n);

          // Only output closed positions (one trade per position). Opening deals
          // have no closePositionDetail and would duplicate/confuse the trade list.
          if (!close) continue;

          trades.push({
            ticketId: str(deal["dealId"]),
            orderId: str(deal["orderId"]),
            positionId: posId,
            symbol: symbolName.replace("/", ""),
            // tradeSide on closing deal = closing order side; opening direction is opposite
            direction: String(deal["tradeSide"]) === "SELL" ? "Buy" : "Sell",
            orderType: "Market",
            dealStatus: str(deal["dealStatus"]),
            openTime: new Date(openTs).toISOString(),
            closeTime: close ? new Date(execTs).toISOString() : "",
            createTimestamp: new Date(createTs).toISOString(),
            executionTimestamp: new Date(execTs).toISOString(),
            openPrice: numStr(close ? entryPrice : Number(deal["executionPrice"])),
            closePrice: numStr(Number(deal["executionPrice"])),
            entryPrice: numStr(entryPrice),
            volume: numStr(volumeToLots(Number(deal["volume"]), symbolName)),
            filledVolume: numStr(volumeToLots(Number(deal["filledVolume"] ?? deal["volume"]), symbolName)),
            commission: numStr(commission),
            swap: numStr(swap),
            fee: numStr(fee),
            grossProfit: numStr(grossProfit),
            netProfit: numStr(netProfit),
            percentGain: numStr(0),
          });
        }
      }

      const idList = Array.from(symbolIds);
      if (idList.length > 0) {
        const resolved = await getSymbolNamesById(connection, accountId, idList);
        for (const trade of trades) {
          if (/^\d+$/.test(trade.symbol)) {
            const resolvedName = resolved.get(Number(trade.symbol));
            if (resolvedName) {
              trade.symbol = resolvedName.replace("/", "");
            }
          }
        }
      }

      return NextResponse.json({ trades });
    } finally {
      connection.close();
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch trades" },
      { status: 502 }
    );
  }
}
