import type { SyncPlan } from "@application/use-cases/sync";
import type { ISyncService, SyncResult } from "@application/ports/services";
import { BarSyncWorker } from "./BarSyncWorker";
import { isOnline } from "./utils/connection";
import { TokenStorage } from "@infrastructure/auth";

export interface SyncOrchestratorOptions {
  /** Maximum concurrent syncs */
  concurrency?: number;
  /** Callback when sync completes */
  onSyncComplete?: (plan: SyncPlan, success: boolean) => void;
  /** Callback for progress updates */
  onProgress?: (plan: SyncPlan, progress: {
    chunk: number;
    totalChunks: number;
    barsSynced: number;
    progressPercent: number;
  }) => void;
}

/**
 * SyncOrchestrator - Coordinates sync operations
 *
 * Manages the execution of sync plans, handles priorities,
 * and coordinates between sync service and worker.
 */
export class SyncOrchestrator {
  private isRunning: boolean = false;
  private cancelRequested: boolean = false;

  constructor(
    private readonly syncService: ISyncService,
    private readonly syncWorker: BarSyncWorker
  ) {}

  /**
   * Execute sync plans
   */
  async executePlans(
    plans: SyncPlan[],
    options: SyncOrchestratorOptions = {}
  ): Promise<SyncResult> {
    if (this.isRunning) {
      return {
        success: false,
        error: "Sync already in progress",
      };
    }

    if (!isOnline()) {
      return {
        success: false,
        error: "Offline - cannot sync",
      };
    }

    const token = TokenStorage.getGlobal();
    if (!token) {
      return {
        success: false,
        error: "No access token available",
      };
    }

    this.isRunning = true;
    this.cancelRequested = false;

    try {
      // Sort plans by priority:
      // 1. Failed (retry first)
      // 2. Pending
      // 3. Completed (skip unless forceFull)
      const sortedPlans = [...plans].sort((a, b) => {
        if (a.progressRecord.status === "failed" && b.progressRecord.status !== "failed") {
          return -1;
        }
        if (a.progressRecord.status !== "failed" && b.progressRecord.status === "failed") {
          return 1;
        }
        return 0;
      });

      // Filter out completed unless forceFull
      const plansToSync = sortedPlans.filter(
        (plan) => plan.progressRecord.status !== "completed"
      );

      if (plansToSync.length === 0) {
        return {
          success: true,
          itemsSynced: 0,
          itemsFailed: 0,
        };
      }

      // Start sync worker
      await this.syncWorker.startSync(plansToSync, {
        accessToken: token.accessToken,
        concurrency: options.concurrency || 1,
        onSyncComplete: options.onSyncComplete,
        onProgress: options.onProgress,
      });

      // Calculate results
      const completed = plansToSync.filter(
        (p) => p.progressRecord.status === "completed"
      ).length;
      const failed = plansToSync.filter(
        (p) => p.progressRecord.status === "failed"
      ).length;

      return {
        success: failed === 0,
        itemsSynced: completed,
        itemsFailed: failed,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: errorMsg,
        itemsSynced: 0,
        itemsFailed: 0,
      };
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Cancel ongoing sync
   */
  cancel(): void {
    this.cancelRequested = true;
    this.syncWorker.cancel();
    this.syncService.cancelSync();
  }

  /**
   * Check if sync is running
   */
  isSyncing(): boolean {
    return this.isRunning;
  }
}
