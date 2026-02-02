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

const trendbarMap: Record<string, number> = {
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
  const data = JSON.parse(text) as Record<string, unknown>[];
  return Array.isArray(data) ? data : [];
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

async function getSymbolId(
  connection: any,
  accountId: number,
  symbol: string
): Promise<number | null> {
  const symbolsRes = await connection.sendCommand("ProtoOASymbolsListReq", {
    ctidTraderAccountId: accountId,
  });
  const symbols = (symbolsRes?.symbol ?? []) as Array<{
    symbolId: number;
    symbolName?: string;
  }>;
  const normalized = symbol.replace("/", "").toUpperCase();
  const found = symbols.find((item) => {
    const name = String(item.symbolName ?? "").replace("/", "").toUpperCase();
    return name === normalized;
  });
  return found?.symbolId ?? null;
}

async function getSymbolDigits(
  connection: any,
  accountId: number,
  symbolId: number
): Promise<number> {
  const res = await connection.sendCommand("ProtoOASymbolByIdReq", {
    ctidTraderAccountId: accountId,
    symbolId: [symbolId],
  });
  const symbol = (res?.symbol ?? [])[0] as Record<string, unknown> | undefined;
  return typeof symbol?.["digits"] === "number" ? symbol["digits"] : 5;
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    accessToken?: string;
    accountNumber?: string;
    accountId?: number;
    symbol?: string;
    timeframe?: string;
    from?: number;
    to?: number;
  };
  if (!body.accessToken || !body.symbol || !body.timeframe) {
    return NextResponse.json({ error: "Missing parameters" }, { status: 400 });
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
        : accounts.find((item) => String(item["accountNumber"]) === body.accountNumber) ??
          accounts[0];
    const accountId = Number(account?.["accountId"]);
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

      const symbolId = await getSymbolId(connection, accountId, body.symbol);
      if (!symbolId) {
        return NextResponse.json({ error: "Symbol not found" }, { status: 404 });
      }
      const digits = await getSymbolDigits(connection, accountId, symbolId);

      const period = trendbarMap[body.timeframe.toUpperCase()];
      if (!period) {
        return NextResponse.json({ error: "Unsupported timeframe" }, { status: 400 });
      }

      const now = Date.now();
      const from = body.from ?? now - 2 * 24 * 60 * 60 * 1000;
      const to = body.to ?? now;

      const response = await connection.sendCommand("ProtoOAGetTrendbarsReq", {
        ctidTraderAccountId: accountId,
        fromTimestamp: from,
        toTimestamp: to,
        period,
        symbolId,
      });

      const bars = (response?.trendbar ?? []) as Array<Record<string, unknown>>;
      const scale = 10 ** digits;
      const mapped = bars.map((bar) => {
        const low = Number(bar["low"]) / scale;
        const open = (Number(bar["deltaOpen"]) + Number(bar["low"])) / scale;
        const close = (Number(bar["deltaClose"]) + Number(bar["low"])) / scale;
        const high = (Number(bar["deltaHigh"]) + Number(bar["low"])) / scale;
        const timestamp =
          Number(bar["utcTimestampInMinutes"]) * 60 * 1000;
        return {
          symbol: body.symbol,
          timeframe: body.timeframe,
          timestamp,
          open,
          high,
          low,
          close,
          volume: Number(bar["volume"]),
        };
      });

      return NextResponse.json({ bars: mapped });
    } finally {
      connection.close();
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch bars" },
      { status: 502 }
    );
  }
}
