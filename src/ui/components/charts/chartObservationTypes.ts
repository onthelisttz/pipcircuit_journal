"use client";

import type { Observation, ObservationChartArea, ObservationChartContext } from "@domain/entities";

export interface ChartObservationWorkspaceApi {
  workspaceMode: "synced" | "history";
  symbol: string | null;
  broker: string | null;
  timeframe: string | null;
  captureObservationContext: () => ObservationChartContext | null;
}

export interface ChartObservationLoadRequest {
  requestId: string;
  observationId?: number | null;
  context: ObservationChartArea;
}

export interface ChartObservationPanelData {
  workspace: ChartObservationWorkspaceApi | null;
  onLoadObservation: (
    observation: Observation,
    contextOverride?: ObservationChartArea | null
  ) => void;
  onClose: () => void;
}
