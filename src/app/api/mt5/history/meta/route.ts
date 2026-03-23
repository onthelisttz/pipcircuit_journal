import { NextResponse } from "next/server";
import { getMt5HistoryRoot, listMt5Symbols } from "@infrastructure/mt5/history";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const symbols = await listMt5Symbols();
    return NextResponse.json({
      sourcePath: getMt5HistoryRoot(),
      symbols,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to inspect MT5 history folder.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

