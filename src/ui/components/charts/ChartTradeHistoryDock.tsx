"use client";

import { useChartTradeHistoryPanel } from "@ui/providers";
import { ChartTradeHistoryPanel } from "./ChartTradeHistoryPanel";

export function ChartTradeHistoryDock() {
  const { panel } = useChartTradeHistoryPanel();

  if (!panel) return null;

  return <ChartTradeHistoryPanel {...panel} />;
}
