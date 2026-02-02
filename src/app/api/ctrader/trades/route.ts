import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { createRequire } from "module";

export const runtime = "nodejs";

const clientId = process.env.NEXT_PUBLIC_CTRADER_CLIENT_ID ?? "";
const clientSecret = process.env.CTRADER_CLIENT_SECRET ?? "";
const protoLiveHost = process.env.CTRADER_PROTO_HOST_LIVE ?? "live.ctraderapi.com";
const protoDemoHost = process.env.CTRADER_PROTO_HOST_DEMO ?? "demo.ctraderapi.com";
const protoPort = Number(process.env.CTRADER_PROTO_PORT ?? "5035");

type TradeRecord = {
  ticketId: string;
  symbol: string;
  direction: "Buy" | "Sell";
  orderType: "Market";
  openTime: string;
  closeTime?: string | null;
  openPrice: number;
  closePrice?: number | null;
  volume: number;
  commission?: number;
  swap?: number;
  fee?: number;
  grossProfit?: number;
  netProfit?: number;
  percentGain?: number;
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

async function getSymbolMap(
  connection: any,
  accountId: number
): Promise<Map<number, string>> {
  const symbolsRes = await connection.sendCommand("ProtoOASymbolsListReq", {
    ctidTraderAccountId: accountId,
  });
  const symbols = (symbolsRes?.symbol ?? []) as Array<{
    symbolId: number;
    symbolName?: string;
  }>;
  const map = new Map<number, string>();
  for (const symbol of symbols) {
    if (symbol.symbolId && symbol.symbolName) {
      map.set(symbol.symbolId, symbol.symbolName);
    }
  }
  return map;
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
  const symbols = (res?.symbol ?? []) as Array<{
    symbolId: number;
    symbolName?: string;
  }>;
  const map = new Map<number, string>();
  for (const symbol of symbols) {
    if (symbol.symbolId && symbol.symbolName) {
      map.set(symbol.symbolId, symbol.symbolName);
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

      const trades: TradeRecord[] = [];
      const symbolIds = new Set<number>();
      for (const [start, end] of ranges) {
        const response = await connection.sendCommand("ProtoOADealListReq", {
          ctidTraderAccountId: accountId,
          fromTimestamp: start,
          toTimestamp: end,
          maxRows: 10000,
        });
        const deals = (response?.deal ?? []) as Array<Record<string, unknown>>;
        for (const deal of deals) {
          const symbolId = Number(deal["symbolId"]);
          if (symbolId) {
            symbolIds.add(symbolId);
          }
          const symbolName = symbolMap.get(symbolId) ?? String(symbolId);
          const dealDigits = typeof deal["moneyDigits"] === "number" ? deal["moneyDigits"] : 2;
          const close = deal["closePositionDetail"] as Record<string, unknown> | undefined;
          const closeDigits =
            typeof close?.["moneyDigits"] === "number" ? close["moneyDigits"] : dealDigits;

          const grossProfit = normalizeMoney(
            typeof close?.["grossProfit"] === "number" ? close["grossProfit"] : undefined,
            closeDigits
          );
          const swap = normalizeMoney(
            typeof close?.["swap"] === "number" ? close["swap"] : undefined,
            closeDigits
          );
          const commission = normalizeMoney(
            typeof close?.["commission"] === "number"
              ? close["commission"]
              : typeof deal["commission"] === "number"
                ? deal["commission"]
                : undefined,
            closeDigits
          );
          const fee = normalizeMoney(
            typeof close?.["pnlConversionFee"] === "number" ? close["pnlConversionFee"] : undefined,
            closeDigits
          );
          const netProfit =
            grossProfit !== undefined
              ? grossProfit - (commission ?? 0) - (swap ?? 0) - (fee ?? 0)
              : undefined;

          trades.push({
            ticketId: String(deal["dealId"]),
            symbol: symbolName.replace("/", ""),
            direction: String(deal["tradeSide"]) === "SELL" ? "Sell" : "Buy",
            orderType: "Market",
            openTime: new Date(Number(deal["executionTimestamp"])).toISOString(),
            closeTime: close ? new Date(Number(deal["executionTimestamp"])).toISOString() : null,
            openPrice: Number(deal["executionPrice"]),
            closePrice: Number(deal["executionPrice"]),
            volume: Number(deal["volume"]) / 100,
            commission,
            swap,
            fee,
            grossProfit,
            netProfit,
            percentGain: 0,
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
