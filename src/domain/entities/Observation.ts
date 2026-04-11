import type { ChartTimeframe } from "./ChartBar";

export type ObservationSource = "manual" | "chart";

export interface ObservationChartDrawingPoint {
  timestamp: number;
  price: number;
}

export interface ObservationChartDrawing {
  id: string;
  toolType: string;
  points: ObservationChartDrawingPoint[];
  options?: Record<string, unknown>;
}

export interface ObservationChartArea {
  workspaceMode?: "synced" | "history" | null;
  broker?: string | null;
  symbol?: string | null;
  timeframe?: ChartTimeframe | null;
  centerTimestamp?: number | null;
  windowSeconds?: number | null;
  drawings?: ObservationChartDrawing[];
}

export interface ObservationChartContext extends ObservationChartArea {
  linkedContexts?: ObservationChartArea[];
}

export interface Observation {
  id?: number;
  /** Supabase row id for cross-device sync when local Dexie id differs. */
  remoteId?: number;
  /** Stable cross-device identity (UUID). */
  clientId?: string;
  categoryId?: number | null;
  source?: ObservationSource;
  chartContext?: ObservationChartContext | null;
  title: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;
  deviceId?: string | null;
  syncedAt?: Date | null;
  version?: number;
}
