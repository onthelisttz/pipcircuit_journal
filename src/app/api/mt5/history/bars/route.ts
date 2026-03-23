import { NextRequest, NextResponse } from "next/server";
import type { ChartTimeframe } from "@domain/entities";
import { readMt5Bars } from "@infrastructure/mt5/history";

export const dynamic = "force-dynamic";

const VALID_TIMEFRAMES = new Set<ChartTimeframe>([
  "M1",
  "M5",
  "M15",
  "M30",
  "H1",
  "H4",
  "D1",
]);

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const symbol = searchParams.get("symbol")?.trim();
  const timeframe = searchParams.get("timeframe")?.trim() as ChartTimeframe | null;
  const from = Number(searchParams.get("from"));
  const to = Number(searchParams.get("to"));
  const limit = Number(searchParams.get("limit") ?? "10000");

  if (!symbol) {
    return NextResponse.json({ error: "Missing symbol." }, { status: 400 });
  }

  if (!timeframe || !VALID_TIMEFRAMES.has(timeframe)) {
    return NextResponse.json({ error: "Invalid timeframe." }, { status: 400 });
  }

  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    return NextResponse.json({ error: "Invalid from/to range." }, { status: 400 });
  }

  try {
    const bars = await readMt5Bars({
      symbol,
      timeframe,
      from,
      to,
      limit: Number.isFinite(limit) ? Math.max(1, Math.min(limit, 50_000)) : 10_000,
    });

    return NextResponse.json({
      symbol,
      timeframe,
      from,
      to,
      bars,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to read MT5 bars.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
