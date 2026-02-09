import type { ISyncService, SyncOptions, SyncResult } from "@application/ports/services";
import type {
  IChartBarRepository,
  ISymbolSyncProgressRepository,
} from "@application/ports/repositories";
import type { ChartBar, SymbolSyncProgress, SymbolSyncStatus } from "@domain/entities";
import { BaseSyncService } from "./BaseSyncService";
import { SyncQueueManager } from "./SyncQueueManager";
import { SyncChartBarsForSymbolUseCase } from "@application/use-cases/sync/SyncChartBarsForSymbolUseCase";
import { BarSyncWorker } from "./BarSyncWorker";
import type { ICTraderAPI } from "@application/ports/services";
import { isOnline } from "./utils/connection";
import { TokenStorage } from "@infrastructure/auth";

/**
 * ChartBarSyncService - Implementation of sync service for chart bars
 *
 * Handles syncing M1 chart bars from cTrader API to Dexie and Supabase.
 */
export class ChartBarSyncService extends BaseSyncService implements ISyncService {
  private syncWorker: BarSyncWorker | null = null;

  constructor(
    dexieChartBarRepo: IChartBarRepository,
    supabaseChartBarRepo: IChartBarRepository,
    dexieProgressRepo: ISymbolSyncProgressRepository,
    supabaseProgressRepo: ISymbolSyncProgressRepository,
    syncQueueManager: SyncQueueManager,
    private readonly api: ICTraderAPI,
    private readonly syncChartBarsUseCase: SyncChartBarsForSymbolUseCase
  ) {
    super(
      dexieChartBarRepo,
      supabaseChartBarRepo,
      dexieProgressRepo,
      supabaseProgressRepo,
      syncQueueManager
    );

    // Create sync worker
    this.syncWorker = new BarSyncWorker(syncChartBarsUseCase, syncQueueManager);
  }

  async initializeSync(userId: string, options?: SyncOptions): Promise<SyncResult> {
    // This will be called from InitializeSyncUseCase
    // For now, return success
    return {
      success: true,
      itemsSynced: 0,
      itemsFailed: 0,
    };
  }

  async syncChartBars(
    userId: string,
    broker: string,
    symbol: string,
    fromDate: Date,
    toDate: Date,
    options?: SyncOptions
  ): Promise<SyncResult> {
    if (!isOnline()) {
      return {
        success: false,
        error: "Offline - cannot sync chart bars",
      };
    }

    // Get access token
    const token = TokenStorage.getGlobal();
    if (!token) {
      return {
        success: false,
        error: "No access token available",
      };
    }

    try {
      const result = await this.syncChartBarsUseCase.execute({
        userId,
        broker,
        symbol,
        fromDate,
        toDate,
        accessToken: token.accessToken,
        accountNumber: options?.syncToCloud ? undefined : undefined, // Will be determined from account
        onProgress: (progress) => {
          // Progress updates are handled by event emitter
        },
        shouldCancel: () => this.shouldCancel(),
      });

      return {
        success: result.success,
        itemsSynced: result.barsSynced,
        itemsFailed: result.success ? 0 : 1,
        error: result.error,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: errorMsg,
        itemsSynced: 0,
        itemsFailed: 1,
      };
    }
  }
}
