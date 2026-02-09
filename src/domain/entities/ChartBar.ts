export type ChartTimeframe = "M1" | "M5" | "M15" | "M30" | "H1" | "H4" | "D1";

export interface ChartBar {
  id?: number;
  /** Broker identifier (e.g., "IC Markets", "FXCM") - used for sharing bars across accounts */
  broker?: string;
  symbol: string;
  timeframe: ChartTimeframe;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** Timestamp when this bar was synced to Supabase */
  syncedAt?: Date | null;
}
