"use client";

import { useChartObservationPanel } from "@ui/providers";
import { ChartObservationPanel } from "./ChartObservationPanel";

export function ChartObservationDock() {
  const { panel } = useChartObservationPanel();

  if (!panel) return null;

  return <ChartObservationPanel {...panel} />;
}
