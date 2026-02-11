import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { createRequire } from "module";

export const runtime = "nodejs";

const apiBase = process.env.NEXT_PUBLIC_CTRADER_API_BASE ?? "https://openapi.ctrader.com";
const clientId = process.env.NEXT_PUBLIC_CTRADER_CLIENT_ID ?? "";
const clientSecret = process.env.CTRADER_CLIENT_SECRET ?? "";
const protoLiveHost = process.env.CTRADER_PROTO_HOST_LIVE ?? "live.ctraderapi.com";
const protoDemoHost = process.env.CTRADER_PROTO_HOST_DEMO ?? "demo.ctraderapi.com";
const protoPort = Number(process.env.CTRADER_PROTO_PORT ?? "5035");

async function fetchAccountsViaHttp(accessToken: string): Promise<Record<string, unknown>[]> {
  const response = await fetch(
    `https://api.spotware.com/connect/tradingaccounts?access_token=${encodeURIComponent(
      accessToken
    )}`,
    {
      method: "GET",
      headers: { Accept: "application/json" },
    }
  );
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`cTrader accounts error ${response.status}: ${text}`);
  }

  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `Invalid accounts JSON: ${error instanceof Error ? error.message : String(error)}`
    );
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

async function fetchAccountsViaProtobuf(
  accessToken: string,
  host: string
): Promise<Record<string, unknown>[]> {
  if (!clientId || !clientSecret) {
    throw new Error("Missing cTrader client credentials");
  }
  await ensureProtoFiles();
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
    const response = await connection.sendCommand("ProtoOAGetAccountListByAccessTokenReq", {
      accessToken,
    });
    const accounts = (response?.ctidTraderAccount ?? []) as Record<string, unknown>[];
    return Array.isArray(accounts) ? accounts : [];
  } finally {
    connection.close();
  }
}

async function ensureProtoFiles(): Promise<void> {
  const packageRoot = path.join(
    process.cwd(),
    "node_modules",
    "@reiryoku",
    "ctrader-layer"
  );
  const sourceDir = path.join(packageRoot, "protobuf");
  const buildDir = path.join(packageRoot, "build", "protobuf");
  const requiredFiles = ["OpenApiCommonMessages.proto", "OpenApiMessages.proto"];

  const hasAllProtoFiles = async (dir: string) => {
    try {
      await Promise.all(
        requiredFiles.map((file) => fs.access(path.join(dir, file)))
      );
      return true;
    } catch {
      return false;
    }
  };

  if (await hasAllProtoFiles(sourceDir)) return;
  if (await hasAllProtoFiles(buildDir)) return;

  throw new Error(
    "Missing ctrader-layer protobuf files in deployment output. " +
      "Ensure Next.js output file tracing includes node_modules/@reiryoku/ctrader-layer/{protobuf,build/protobuf}/**/*."
  );
}

export async function POST(request: Request) {
  const body = (await request.json()) as { accessToken?: string };
  if (!body.accessToken) {
    return NextResponse.json({ error: "Missing access token" }, { status: 400 });
  }

  try {
    let accounts: Record<string, unknown>[] = [];
    try {
      accounts = await fetchAccountsViaHttp(body.accessToken);
    } catch {
      accounts = [];
    }

    let source: "http" | "protobuf" | "none" = "http";
    if (accounts.length === 0) {
      try {
        const liveAccounts = await fetchAccountsViaProtobuf(body.accessToken, protoLiveHost);
        const demoAccounts = await fetchAccountsViaProtobuf(body.accessToken, protoDemoHost);
        const combined = [...liveAccounts, ...demoAccounts];
        const unique = new Map<string, Record<string, unknown>>();
        for (const account of combined) {
          const id = String(
            account["ctidTraderAccountId"] ??
              account["accountNumber"] ??
              account["login"] ??
              account["accountId"] ??
              account["id"]
          );
          if (id && id !== "undefined") {
            unique.set(id, account);
          }
        }
        accounts = Array.from(unique.values());
        source = "protobuf";
      } catch {
        source = "none";
      }
    }

    return NextResponse.json({ accounts, source });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch accounts" },
      { status: 502 }
    );
  }
}
