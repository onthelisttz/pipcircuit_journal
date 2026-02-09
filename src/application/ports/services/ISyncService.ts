import type { SymbolSyncProgress } from "@domain/entities";

/**
 * Sync result indicating success or failure
 */
export interface SyncResult {
  success: boolean;
  error?: string;
  itemsSynced?: number;
  itemsFailed?: number;
}

/**
 * Sync options for configuring sync behavior
 */
export interface SyncOptions {
  /** Force full sync even if incremental is available */
  forceFull?: boolean;
  /** Maximum number of items to sync per batch */
  batchSize?: number;
  /** Timeout in milliseconds */
  timeout?: number;
  /** Whether to sync to Supabase (requires online) */
  syncToCloud?: boolean;
}

/**
 * Sync Service Interface
 *
 * Handles synchronization between local Dexie database and Supabase cloud storage.
 * Supports offline-first architecture with background sync.
 */
export interface ISyncService {
  /**
   * Initialize sync for a user (called after login)
   * Determines sync strategy (full vs incremental) and starts sync process
   */
  initializeSync(userId: string, options?: SyncOptions): Promise<SyncResult>;

  /**
   * Sync chart bars for a specific broker and symbol
   */
  syncChartBars(
    userId: string,
    broker: string,
    symbol: string,
    fromDate: Date,
    toDate: Date,
    options?: SyncOptions
  ): Promise<SyncResult>;

  /**
   * Sync all chart bars for a broker (all symbols)
   */
  syncBrokerChartBars(
    userId: string,
    broker: string,
    fromDate: Date,
    toDate: Date,
    options?: SyncOptions
  ): Promise<SyncResult>;

  /**
   * Get sync progress for a broker and symbol
   */
  getSyncProgress(
    userId: string,
    broker: string,
    symbol: string
  ): Promise<SymbolSyncProgress | null>;

  /**
   * Get all sync progress for a user
   */
  getAllSyncProgress(userId: string): Promise<SymbolSyncProgress[]>;

  /**
   * Start realtime sync subscriptions (for live updates)
   */
  startRealtimeSync(userId: string): void;

  /**
   * Stop realtime sync subscriptions
   */
  stopRealtimeSync(): void;

  /**
   * Process sync queue (sync pending operations)
   */
  processSyncQueue(userId: string): Promise<SyncResult>;

  /**
   * Check if sync is currently in progress
   */
  isSyncing(): boolean;

  /**
   * Cancel ongoing sync operations
   */
  cancelSync(): Promise<void>;
}
