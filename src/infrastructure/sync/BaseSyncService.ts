import type { ISyncService, SyncOptions, SyncResult } from "@application/ports/services";
import type { IChartBarRepository, ISymbolSyncProgressRepository } from "@application/ports/repositories";
import type { ChartBar, SymbolSyncProgress, SymbolSyncStatus } from "@domain/entities";
import { isOnline, onConnectionChange } from "./utils/connection";
import { SyncQueueManager, type QueueProcessorOptions } from "./SyncQueueManager";

/**
 * BaseSyncService - Base implementation of sync service
 *
 * Provides common sync functionality that can be extended
 * for specific sync implementations (e.g., ChartBarSyncService)
 */
export abstract class BaseSyncService implements ISyncService {
  private isSyncingFlag: boolean = false;
  private cancelRequested: boolean = false;
  private connectionUnsubscribe?: () => void;

  constructor(
    protected readonly dexieChartBarRepo: IChartBarRepository,
    protected readonly supabaseChartBarRepo: IChartBarRepository,
    protected readonly dexieProgressRepo: ISymbolSyncProgressRepository,
    protected readonly supabaseProgressRepo: ISymbolSyncProgressRepository,
    protected readonly syncQueueManager: SyncQueueManager
  ) {
    // Subscribe to connection changes
    this.connectionUnsubscribe = onConnectionChange((isOnline) => {
      if (isOnline && !this.isSyncingFlag) {
        // Auto-process queue when coming back online
        this.processSyncQueue("").catch(console.error);
      }
    });
  }

  /**
   * Initialize sync for a user
   */
  abstract initializeSync(userId: string, options?: SyncOptions): Promise<SyncResult>;

  /**
   * Sync chart bars for a specific broker and symbol
   */
  abstract syncChartBars(
    userId: string,
    broker: string,
    symbol: string,
    fromDate: Date,
    toDate: Date,
    options?: SyncOptions
  ): Promise<SyncResult>;

  /**
   * Sync all chart bars for a broker
   */
  async syncBrokerChartBars(
    userId: string,
    broker: string,
    fromDate: Date,
    toDate: Date,
    options?: SyncOptions
  ): Promise<SyncResult> {
    // Get all symbols for this broker from progress records
    const allProgress = await this.dexieProgressRepo.getByBroker(broker);
    const symbols = [...new Set(allProgress.map((p) => p.symbol))];

    if (symbols.length === 0) {
      return {
        success: true,
        itemsSynced: 0,
        itemsFailed: 0,
      };
    }

    let totalSynced = 0;
    let totalFailed = 0;

    for (const symbol of symbols) {
      if (this.cancelRequested) {
        break;
      }

      try {
        const result = await this.syncChartBars(userId, broker, symbol, fromDate, toDate, options);
        totalSynced += result.itemsSynced || 0;
        totalFailed += result.itemsFailed || 0;
      } catch (error) {
        totalFailed++;
        console.error(`Failed to sync ${broker}/${symbol}:`, error);
      }
    }

    return {
      success: totalFailed === 0,
      itemsSynced: totalSynced,
      itemsFailed: totalFailed,
    };
  }

  /**
   * Get sync progress for a broker and symbol
   */
  async getSyncProgress(
    userId: string,
    broker: string,
    symbol: string
  ): Promise<SymbolSyncProgress | null> {
    // Try Dexie first (faster)
    const local = await this.dexieProgressRepo.getByBrokerAndSymbol(broker, symbol);
    if (local) {
      return local;
    }

    // Fallback to Supabase if online
    if (isOnline()) {
      return this.supabaseProgressRepo.getByBrokerAndSymbol(broker, symbol);
    }

    return null;
  }

  /**
   * Get all sync progress for a user
   */
  async getAllSyncProgress(userId: string): Promise<SymbolSyncProgress[]> {
    // Get from Dexie (local cache)
    const local = await this.dexieProgressRepo.getAll();

    // If online, sync with Supabase
    if (isOnline()) {
      try {
        const cloud = await this.supabaseProgressRepo.getAll();
        // Merge and update local cache
        for (const cloudProgress of cloud) {
          await this.dexieProgressRepo.upsert(cloudProgress);
        }
        return cloud;
      } catch (error) {
        console.warn("Failed to fetch sync progress from Supabase:", error);
        // Return local cache if cloud fetch fails
        return local;
      }
    }

    return local;
  }

  /**
   * Start realtime sync subscriptions
   */
  startRealtimeSync(userId: string): void {
    // Realtime sync is handled by useRealtimeSync hook in app layout
    // This method is kept for interface compatibility
    
  }

  /**
   * Stop realtime sync subscriptions
   */
  stopRealtimeSync(): void {
    // Realtime sync is handled by useRealtimeSync hook in app layout
    // This method is kept for interface compatibility
    
  }

  /**
   * Process sync queue
   */
  async processSyncQueue(userId: string): Promise<SyncResult> {
    if (!isOnline()) {
      return {
        success: false,
        error: "Offline - cannot process sync queue",
      };
    }

    if (this.isSyncingFlag) {
      return {
        success: false,
        error: "Sync already in progress",
      };
    }

    this.isSyncingFlag = true;
    this.cancelRequested = false;

    try {
      const options: QueueProcessorOptions = {
        concurrency: 3,
        retryOptions: {
          maxAttempts: 3,
          initialDelay: 1000,
          multiplier: 2,
        },
        onJobComplete: (job, success) => {
          
        },
        onJobError: (job, error) => {
          console.error(`[SyncQueue] Job ${job.id} error:`, error);
        },
      };

      await this.syncQueueManager.processQueue(options);

      const stats = await this.syncQueueManager.getQueueStats();

      return {
        success: stats.failed === 0,
        itemsSynced: stats.completed,
        itemsFailed: stats.failed,
      };
    } finally {
      this.isSyncingFlag = false;
    }
  }

  /**
   * Check if sync is in progress
   */
  isSyncing(): boolean {
    return this.isSyncingFlag;
  }

  /**
   * Cancel ongoing sync operations
   */
  async cancelSync(): Promise<void> {
    this.cancelRequested = true;
    // Wait a bit for current operations to finish
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  /**
   * Check if cancel was requested
   */
  protected shouldCancel(): boolean {
    return this.cancelRequested;
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.connectionUnsubscribe?.();
    this.cancelSync();
  }
}
