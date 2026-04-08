/**
 * SymbolSyncProgress - Tracks sync progress for chart bars per symbol
 *
 * Used to track the progress of syncing M1 chart bars for each symbol,
 * allowing users to see sync status and resume interrupted syncs.
 */
export type SymbolSyncStatus = "pending" | "syncing" | "completed" | "failed";

export interface SymbolSyncProgress {
  id?: number;
  /** Broker identifier (e.g., "IC Markets", "FXCM") */
  broker: string;
  /** Trading symbol (e.g., "EURUSD", "GBPUSD") */
  symbol: string;
  /** First bar date found/synced */
  firstBarDate: Date | null;
  /** Last bar date synced */
  lastBarDate: Date | null;
  /** Last sync timestamp */
  lastSyncTime: Date | null;
  /** Total number of bars synced */
  totalBars: number;
  /** Current sync status */
  status: SymbolSyncStatus;
  /** Error message if status is 'failed' */
  error?: string | null;
  /** Progress percentage (0-100) */
  progressPercent?: number;
  /** Current chunk start being fetched */
  currentFetchFrom?: Date | null;
  /** Current chunk end being fetched */
  currentFetchTo?: Date | null;
  /** When the current chunk fetch started */
  currentFetchStartedAt?: Date | null;
}
