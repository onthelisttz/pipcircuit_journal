import { NextResponse } from "next/server";
import {
  listMt5Symbols,
  resolveMt5HistoryRoot,
} from "@infrastructure/mt5/history";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const rootPath = new URL(request.url).searchParams.get("rootPath");
    const symbols = await listMt5Symbols(rootPath);
    return NextResponse.json({
      sourcePath: resolveMt5HistoryRoot(rootPath),
      symbols,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to inspect MT5 history folder.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
