import type { SymbolSyncProgress, SymbolSyncStatus } from "@domain/entities";

export interface ISymbolSyncProgressRepository {
  /**
   * Get sync progress for a specific broker and symbol
   */
  getByBrokerAndSymbol(
    broker: string,
    symbol: string
  ): Promise<SymbolSyncProgress | null>;

  /**
   * Get all sync progress records for a broker
   */
  getByBroker(broker: string): Promise<SymbolSyncProgress[]>;

  /**
   * Get all sync progress records
   */
  getAll(): Promise<SymbolSyncProgress[]>;

  /**
   * Get sync progress by status
   */
  getByStatus(status: SymbolSyncStatus): Promise<SymbolSyncProgress[]>;

  /**
   * Create or update sync progress
   */
  upsert(progress: SymbolSyncProgress): Promise<void>;

  /**
   * Update sync progress status
   */
  updateStatus(
    broker: string,
    symbol: string,
    status: SymbolSyncStatus,
    error?: string | null
  ): Promise<void>;

  /**
   * Update sync progress with new data
   */
  updateProgress(
    broker: string,
    symbol: string,
    updates: Partial<SymbolSyncProgress>
  ): Promise<void>;

  /**
   * Delete sync progress
   */
  delete(broker: string, symbol: string): Promise<void>;

  /**
   * Delete all sync progress for a broker
   */
  deleteByBroker(broker: string): Promise<void>;
}
