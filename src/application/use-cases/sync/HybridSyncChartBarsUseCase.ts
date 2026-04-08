import type { ICTraderAPI } from "@application/ports/services";
import type { IChartBarRepository, ISymbolSyncProgressRepository } from "@application/ports/repositories";
import type { ChartBar, SymbolSyncProgress, SymbolSyncStatus } from "@domain/entities";
import { CTRADER_M1_MAX_CHUNK_DAYS } from "@config/ctrader";
import { CTraderMapper } from "@infrastructure/api/ctrader/CTraderMapper";
import { progressEventEmitter } from "@infrastructure/sync/ProgressEventEmitter";
import { defaultRetryCondition, retry } from "@infrastructure/sync/utils";

export interface HybridSyncChartBarsParams {
  userId: string;
  broker: string;
  symbol: string;
  fromDate: Date;
  toDate: Date;
  accessToken: string;
  accountNumber?: string;
  /** Chunk size in days (default: 9 for M1 - cTrader API limit is 14k bars/request) */
  chunkDays?: number;
  /** Force full sync from cTrader (skip local cache checks) */
  forceFullSync?: boolean;
  /** Callback for progress updates */
  onProgress?: (progress: {
    chunk: number;
    totalChunks: number;
    barsSynced: number;
    progressPercent: number;
    source: "dexie" | "ctrader";
  }) => void;
  /** Check if sync should be cancelled */
  shouldCancel?: () => boolean;
}

export interface HybridSyncChartBarsResult {
  success: boolean;
  totalBars: number;
  barsSynced: number;
  chunksProcessed: number;
  source: "dexie" | "ctrader";
  error?: string;
}

interface LocalSyncSnapshot {
  cachedTotalBars: number;
  cachedFirstBarDate: Date | null;
  cachedLastBarDate: Date | null;
  existingProgress: SymbolSyncProgress | null;
}

const M1_BAR_MS = 60 * 1000;

/**
 * HybridSyncChartBarsUseCase
 *
 * Implements hybrid sync strategy:
 * 1. Check Dexie (local) first -> if data exists, use it
 * 2. If local cache is empty or stale -> fetch from cTrader API
 * 3. For incremental updates, fetch only new data after last sync timestamp
 * 4. Store in Dexie (offline-first)
 */
export class HybridSyncChartBarsUseCase {
  constructor(
    private readonly api: ICTraderAPI,
    private readonly dexieChartBarRepo: IChartBarRepository,
    private readonly progressRepo: ISymbolSyncProgressRepository
  ) {}

  async execute(params: HybridSyncChartBarsParams): Promise<HybridSyncChartBarsResult> {
    const {
      broker,
      symbol,
      toDate,
      forceFullSync = false,
    } = params;

    

    try {
      const progress = await this.progressRepo.getByBrokerAndSymbol(broker, symbol);
      const [cachedDateRange, cachedTotalBars] = await Promise.all([
        this.dexieChartBarRepo.getDateRange
          ? this.dexieChartBarRepo.getDateRange(broker, symbol, "M1")
          : Promise.resolve({ firstBarDate: null, lastBarDate: null }),
        this.dexieChartBarRepo.countBars
          ? this.dexieChartBarRepo.countBars(broker, symbol, "M1")
          : Promise.resolve(progress?.totalBars ?? 0),
      ]);

      const localSnapshot: LocalSyncSnapshot = {
        cachedTotalBars,
        cachedFirstBarDate: cachedDateRange.firstBarDate,
        cachedLastBarDate: cachedDateRange.lastBarDate,
        existingProgress: progress,
      };

      if (!forceFullSync && cachedDateRange.lastBarDate) {
        const resumeFromDate = new Date(cachedDateRange.lastBarDate.getTime() + M1_BAR_MS);
        const hasFetchedThroughTarget =
          cachedDateRange.lastBarDate.getTime() >= toDate.getTime() - M1_BAR_MS;

        if (progress?.status === "completed" && hasFetchedThroughTarget) {
          return {
            success: true,
            totalBars: cachedTotalBars,
            barsSynced: 0,
            chunksProcessed: 0,
            source: "dexie",
          };
        }

        if (resumeFromDate <= toDate) {
          return await this.syncFromCTrader(
            {
              ...params,
              fromDate: resumeFromDate,
            },
            "ctrader",
            localSnapshot
          );
        }

        return {
          success: true,
          totalBars: cachedTotalBars,
          barsSynced: 0,
          chunksProcessed: 0,
          source: "dexie",
        };
      }

      return await this.syncFromCTrader(params, "ctrader", localSnapshot);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[HybridSync] Hybrid sync failed:`, error);
      
      await this.progressRepo.updateStatus(
        broker,
        symbol,
        "failed" as SymbolSyncStatus,
        errorMsg
      );

      return {
        success: false,
        totalBars: 0,
        barsSynced: 0,
        chunksProcessed: 0,
        source: "ctrader",
        error: errorMsg,
      };
    }
  }

  /**
   * Syncs chart bars directly from cTrader into local Dexie storage.
   */
  private async syncFromCTrader(
    params: HybridSyncChartBarsParams,
    source: "ctrader",
    localSnapshot?: LocalSyncSnapshot
  ): Promise<HybridSyncChartBarsResult> {
    const {
      broker,
      symbol,
      fromDate,
      toDate,
      accessToken,
      accountNumber,
      chunkDays = CTRADER_M1_MAX_CHUNK_DAYS,
      onProgress,
      shouldCancel,
    } = params;

    

    const existingProgress = localSnapshot?.existingProgress
      ?? await this.progressRepo.getByBrokerAndSymbol(broker, symbol);
    const cachedTotalBars = localSnapshot?.cachedTotalBars ?? 0;
    const cachedFirstBarDate = localSnapshot?.cachedFirstBarDate ?? null;
    const cachedLastBarDate = localSnapshot?.cachedLastBarDate ?? null;
    const hasLocalHistory = cachedTotalBars > 0 && cachedLastBarDate !== null;
    const isIncrementalSync =
      existingProgress?.status === "completed" &&
      cachedLastBarDate !== null &&
      fromDate.getTime() >= cachedLastBarDate.getTime() - M1_BAR_MS;

    try {
      await Promise.race([
        this.progressRepo.updateStatus(broker, symbol, "syncing" as SymbolSyncStatus),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error("updateStatus timeout")), 5000)
        )
      ]);
    } catch (error) {
      console.warn(`[HybridSync] Failed to update status, continuing anyway:`, error);
    }

    try {
      // Calculate chunks
      const totalDays = Math.ceil((toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24));
      const totalChunks = Math.max(1, Math.ceil(totalDays / chunkDays));
      
      

      let totalBars = hasLocalHistory ? cachedTotalBars : 0;
      let barsSynced = 0;
      let chunksProcessed = 0;
      let firstBarDate: Date | null = existingProgress?.firstBarDate
        ? new Date(existingProgress.firstBarDate)
        : cachedFirstBarDate;
      let lastBarDate: Date | null = existingProgress?.lastBarDate
        ? new Date(existingProgress.lastBarDate)
        : cachedLastBarDate;

      // Process in chunks
      for (let chunk = 0; chunk < totalChunks; chunk++) {
        // Check if cancelled
        if (shouldCancel?.()) {
          await this.progressRepo.updateStatus(
            broker,
            symbol,
            "pending" as SymbolSyncStatus,
            "Sync cancelled by user"
          );
          await this.progressRepo.updateProgress(broker, symbol, {
            currentFetchFrom: null,
            currentFetchTo: null,
            currentFetchStartedAt: null,
          });
          return {
            success: false,
            totalBars,
            barsSynced,
            chunksProcessed,
            source,
            error: "Sync cancelled",
          };
        }

        // Calculate chunk date range
        const chunkStart = new Date(fromDate);
        chunkStart.setDate(chunkStart.getDate() + chunk * chunkDays);

        const chunkEnd = new Date(chunkStart);
        chunkEnd.setDate(chunkEnd.getDate() + chunkDays);
        if (chunkEnd > toDate) {
          chunkEnd.setTime(toDate.getTime());
        }

        const chunkFrom = chunkStart.getTime();
        const chunkTo = chunkEnd.getTime();
        const chunkFetchStartedAt = new Date();

        try {
          await this.progressRepo.updateProgress(broker, symbol, {
            currentFetchFrom: new Date(chunkFrom),
            currentFetchTo: new Date(chunkTo),
            currentFetchStartedAt: chunkFetchStartedAt,
          });
          const activeProgress = await this.progressRepo.getByBrokerAndSymbol(broker, symbol);
          if (activeProgress) {
            progressEventEmitter.emit(activeProgress);
          }

          const fetchResult = await retry(
            () =>
              this.api.getBars(
                accessToken,
                symbol,
                "M1",
                chunkFrom,
                chunkTo,
                accountNumber
              ),
            {
              maxAttempts: 3,
              initialDelay: 1000,
              maxDelay: 5000,
              retryCondition: defaultRetryCondition,
            }
          );

          if (!fetchResult.success) {
            throw fetchResult.error ?? new Error("Failed to fetch bars");
          }

          const apiBars = fetchResult.result ?? [];

          if (apiBars.length === 0) {
            chunksProcessed++;
            const progressPercent = Math.round((chunksProcessed / totalChunks) * 100);
            await this.progressRepo.updateProgress(broker, symbol, {
              totalBars,
              firstBarDate,
              lastBarDate,
              progressPercent,
              lastSyncTime: new Date(),
              currentFetchFrom: new Date(chunkFrom),
              currentFetchTo: new Date(chunkTo),
              currentFetchStartedAt: chunkFetchStartedAt,
            });
            const currentProgress = await this.progressRepo.getByBrokerAndSymbol(broker, symbol);
            if (currentProgress) {
              progressEventEmitter.emit(currentProgress);
            }
            continue;
          }

          // Convert to domain bars and add broker field
          const chartBars: ChartBar[] = apiBars.map((bar) => {
            const domainBar = CTraderMapper.toChartBar(bar);
            return {
              ...domainBar,
              broker,
              syncedAt: new Date(),
            };
          });

          // Update first/last bar dates
          const sortedBars = chartBars.sort((a, b) => a.timestamp - b.timestamp);
          if (sortedBars.length > 0) {
            const chunkFirstDate = new Date(sortedBars[0].timestamp);
            const chunkLastDate = new Date(sortedBars[sortedBars.length - 1].timestamp);

            if (!isIncrementalSync) {
              if (!firstBarDate || chunkFirstDate < firstBarDate) {
                firstBarDate = chunkFirstDate;
              }
            }
            if (!lastBarDate || chunkLastDate > lastBarDate) {
              lastBarDate = chunkLastDate;
            }
          }

          // Local-only storage (offline-first)
          await this.dexieChartBarRepo.upsertMany(chartBars);

          totalBars += chartBars.length;
          barsSynced += chartBars.length;
          chunksProcessed++;

          // Update progress
          const progressPercent = Math.round((chunksProcessed / totalChunks) * 100);
          
          await this.progressRepo.updateProgress(broker, symbol, {
            totalBars,
            firstBarDate,
            lastBarDate,
            progressPercent,
            lastSyncTime: new Date(),
            currentFetchFrom: new Date(chunkFrom),
            currentFetchTo: new Date(chunkTo),
            currentFetchStartedAt: chunkFetchStartedAt,
          });

          // Emit progress event
          const currentProgress = await this.progressRepo.getByBrokerAndSymbol(broker, symbol);
          if (currentProgress) {
            progressEventEmitter.emit(currentProgress);
          }

          // Notify progress callback
          onProgress?.({
            chunk: chunksProcessed,
            totalChunks,
            barsSynced,
            progressPercent,
            source,
          });

          // Small delay to avoid rate limiting
          await new Promise((resolve) => setTimeout(resolve, 100));
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          const chunkError = `Chunk ${chunk + 1} failed: ${errorMsg}`;
          console.error(`[HybridSync] Failed to sync chunk ${chunk + 1}/${totalChunks}:`, error);

          await this.progressRepo.updateStatus(
            broker,
            symbol,
            "failed" as SymbolSyncStatus,
            chunkError
          );
          await this.progressRepo.updateProgress(broker, symbol, {
            totalBars,
            firstBarDate,
            lastBarDate,
            progressPercent: Math.round((chunksProcessed / totalChunks) * 100),
            currentFetchFrom: new Date(chunkFrom),
            currentFetchTo: new Date(chunkTo),
            currentFetchStartedAt: chunkFetchStartedAt,
          });

          const failedProgress = await this.progressRepo.getByBrokerAndSymbol(broker, symbol);
          if (failedProgress) {
            progressEventEmitter.emit(failedProgress);
          }

          return {
            success: false,
            totalBars,
            barsSynced,
            chunksProcessed,
            source,
            error: chunkError,
          };
        }
      }

      // Final progress update
      await this.progressRepo.updateStatus(
        broker,
        symbol,
        "completed" as SymbolSyncStatus
      );

      // Recalculate totalBars from actual bars in Dexie to ensure accuracy
      // This is important because totalBars can get out of sync
      const actualTotalBars = this.dexieChartBarRepo.countBars
        ? await this.dexieChartBarRepo.countBars(broker, symbol, "M1")
        : totalBars;
      

      const finalFirstBarDate = cachedFirstBarDate || firstBarDate;

      // Also recalculate date range from Dexie for accuracy
      const actualDateRange = this.dexieChartBarRepo.getDateRange
        ? await this.dexieChartBarRepo.getDateRange(broker, symbol, "M1")
        : { firstBarDate: null, lastBarDate: null };
      const finalFirstBarDateFromDexie = actualDateRange.firstBarDate || finalFirstBarDate;
      const finalLastBarDate = actualDateRange.lastBarDate || lastBarDate;

      

      await this.progressRepo.updateProgress(broker, symbol, {
        totalBars: actualTotalBars,
        firstBarDate: finalFirstBarDateFromDexie,
        lastBarDate: finalLastBarDate,
        progressPercent: 100,
        lastSyncTime: new Date(),
        error: null,
        currentFetchFrom: null,
        currentFetchTo: null,
        currentFetchStartedAt: null,
      });

      const updatedProgress = await this.progressRepo.getByBrokerAndSymbol(broker, symbol);
      if (updatedProgress) {
        progressEventEmitter.emit(updatedProgress);
      }

      return {
        success: true,
        totalBars,
        barsSynced,
        chunksProcessed,
        source,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      
      await this.progressRepo.updateStatus(
        broker,
        symbol,
        "failed" as SymbolSyncStatus,
        errorMsg
      );
      await this.progressRepo.updateProgress(broker, symbol, {
        currentFetchFrom: null,
        currentFetchTo: null,
        currentFetchStartedAt: null,
      });

      const failedProgress = await this.progressRepo.getByBrokerAndSymbol(broker, symbol);
      if (failedProgress) {
        progressEventEmitter.emit(failedProgress);
      }

      return {
        success: false,
        totalBars: 0,
        barsSynced: 0,
        chunksProcessed: 0,
        source,
        error: errorMsg,
      };
    }
  }
}

