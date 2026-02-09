import type { ISyncQueueRepository } from "@application/ports/repositories";
import type { ICTraderAPI } from "@application/ports/services";
import type { SyncPlan } from "@application/use-cases/sync";
import { SyncChartBarsForSymbolUseCase } from "@application/use-cases/sync/SyncChartBarsForSymbolUseCase";
import { SyncAction, SyncStatus } from "@domain/enums";
import type { SyncJob } from "@domain/entities";
import { SyncQueueManager, type QueueProcessorOptions } from "./SyncQueueManager";
import { isOnline } from "./utils/connection";

export interface BarSyncWorkerOptions {
  /** Maximum concurrent syncs */
  concurrency?: number;
  /** Access token for cTrader API */
  accessToken: string;
  /** Account number for API calls */
  accountNumber?: string;
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
 * BarSyncWorker - Background worker for syncing chart bars
 *
 * Processes sync plans and syncs chart bars for each symbol
 */
export class BarSyncWorker {
  private isRunning: boolean = false;
  private cancelRequested: boolean = false;
  private activeSyncs: Map<string, AbortController> = new Map();

  constructor(
    private readonly syncChartBarsUseCase: SyncChartBarsForSymbolUseCase,
    private readonly syncQueueManager: SyncQueueManager
  ) {}

  /**
   * Start syncing plans
   */
  async startSync(plans: SyncPlan[], options: BarSyncWorkerOptions): Promise<void> {
    if (this.isRunning) {
      throw new Error("Sync worker is already running");
    }

    if (!isOnline()) {
      throw new Error("Cannot start sync - offline");
    }

    this.isRunning = true;
    this.cancelRequested = false;

    try {
      const concurrency = options.concurrency || 1;

      // Process plans with concurrency limit
      for (let i = 0; i < plans.length; i += concurrency) {
        if (this.cancelRequested) {
          break;
        }

        const batch = plans.slice(i, i + concurrency);
        await Promise.allSettled(
          batch.map((plan) => this.syncPlan(plan, options))
        );
      }
    } finally {
      this.isRunning = false;
      this.activeSyncs.clear();
    }
  }

  /**
   * Sync a single plan
   */
  private async syncPlan(plan: SyncPlan, options: BarSyncWorkerOptions): Promise<void> {
    const key = `${plan.broker}:${plan.symbol}`;
    const abortController = new AbortController();
    this.activeSyncs.set(key, abortController);

    try {
      const result = await this.syncChartBarsUseCase.execute({
        userId: "", // Will be set by use case if needed
        broker: plan.broker,
        symbol: plan.symbol,
        fromDate: plan.startDate,
        toDate: plan.endDate,
        accessToken: options.accessToken,
        accountNumber: options.accountNumber,
        shouldCancel: () => abortController.signal.aborted || this.cancelRequested,
        onProgress: (progress) => {
          options.onProgress?.(plan, progress);
        },
      });

      options.onSyncComplete?.(plan, result.success);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`Failed to sync ${key}:`, errorMsg);
      options.onSyncComplete?.(plan, false);
    } finally {
      this.activeSyncs.delete(key);
    }
  }

  /**
   * Queue plans for background sync
   */
  async queuePlans(plans: SyncPlan[], userId: string): Promise<void> {
    for (const plan of plans) {
      const job: Omit<SyncJob, "id"> = {
        action: SyncAction.Create,
        table: "chart_bars",
        payload: {
          broker: plan.broker,
          symbol: plan.symbol,
          startDate: plan.startDate.toISOString(),
          endDate: plan.endDate.toISOString(),
        },
        timestamp: new Date(),
        retryCount: 0,
        status: SyncStatus.Pending,
      };

      await this.syncQueueManager.enqueue(job);
    }
  }

  /**
   * Process queued sync jobs
   */
  async processQueue(options: BarSyncWorkerOptions): Promise<void> {
    const queueOptions: QueueProcessorOptions = {
      concurrency: options.concurrency || 1,
      retryOptions: {
        maxAttempts: 3,
        initialDelay: 1000,
        multiplier: 2,
      },
      onJobComplete: async (job, success) => {
        if (success && job.payload) {
          const plan: SyncPlan = {
            broker: job.payload.broker as string,
            symbol: job.payload.symbol as string,
            startDate: new Date(job.payload.startDate as string),
            endDate: new Date(job.payload.endDate as string),
            progressRecord: {
              broker: job.payload.broker as string,
              symbol: job.payload.symbol as string,
              status: "pending",
              totalBars: 0,
              firstBarDate: null,
              lastBarDate: null,
              lastSyncTime: null,
            },
          };
          options.onSyncComplete?.(plan, true);
        }
      },
    };

    await this.syncQueueManager.processQueue(queueOptions);
  }

  /**
   * Cancel ongoing syncs
   */
  cancel(): void {
    this.cancelRequested = true;
    // Abort all active syncs
    for (const controller of this.activeSyncs.values()) {
      controller.abort();
    }
  }

  /**
   * Check if worker is running
   */
  isWorkerRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Get active sync count
   */
  getActiveSyncCount(): number {
    return this.activeSyncs.size;
  }
}
