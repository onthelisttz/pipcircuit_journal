import type { ICTraderAPI } from "@application/ports/services";
import type { IChartBarRepository, ISymbolSyncProgressRepository } from "@application/ports/repositories";
import type { ChartBar, SymbolSyncStatus } from "@domain/entities";
import { CTRADER_M1_MAX_CHUNK_DAYS } from "@config/ctrader";
import { CTraderMapper } from "@infrastructure/api/ctrader/CTraderMapper";
import { progressEventEmitter } from "@infrastructure/sync/ProgressEventEmitter";

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
      fromDate,
      toDate,
      forceFullSync = false,
    } = params;

    

    try {
      // Step 1: Check Dexie first (local)
      const progress = await this.progressRepo.getByBrokerAndSymbol(broker, symbol);
      const dexieBars = await this.dexieChartBarRepo.getByWindow(
        symbol,
        "M1",
        fromDate.getTime(),
        toDate.getTime(),
        broker
      );

      if (dexieBars.length > 0 && !forceFullSync) {
        // Only short-circuit to Dexie when this symbol already completed a local sync.
        // Pending/failed/incomplete symbols may have partial bars cached and still need
        // a full cTrader download to finish the requested range.
        const isLocallyComplete = progress?.status === "completed";

        // Check if we need incremental update (check last sync timestamp)
        const needsIncrementalUpdate = progress?.lastSyncTime 
          ? new Date(progress.lastSyncTime) < toDate
          : false;

        if (isLocallyComplete && !needsIncrementalUpdate) {
          
          return {
            success: true,
            totalBars: dexieBars.length,
            barsSynced: 0,
            chunksProcessed: 0,
            source: "dexie",
          };
        }

        // Need incremental update, or local cache is only partial/incomplete.
        // In both cases continue with cTrader instead of stopping at the cached bars.
        const lastSyncTime = progress?.lastSyncTime ? new Date(progress.lastSyncTime) : fromDate;
        return await this.syncFromCTrader(
          {
            ...params,
            fromDate:
              isLocallyComplete && lastSyncTime > fromDate
                ? lastSyncTime
                : fromDate,
          },
          "ctrader"
        );
      }

      // Step 2: Local cache is empty/stale, fetch from cTrader
      
      return await this.syncFromCTrader(params, "ctrader");
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
    source: "ctrader"
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

    

    // Update status to syncing
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
      // Fetch existing progress for incremental sync (preserve firstBarDate and totalBars)
      const existingProgress = await this.progressRepo.getByBrokerAndSymbol(broker, symbol);
      const existingLastBar = existingProgress?.lastBarDate
        ? new Date(existingProgress.lastBarDate).getTime()
        : 0;
      const isIncrementalSync =
        existingProgress?.status === "completed" &&
        existingProgress?.firstBarDate &&
        existingProgress?.lastBarDate &&
        fromDate.getTime() >= existingLastBar - 86400000; // fromDate at or near lastBarDate = incremental

      const baseTotalBars = isIncrementalSync && existingProgress ? existingProgress.totalBars : 0;
      const preservedFirstBarDate: Date | null =
        isIncrementalSync && existingProgress?.firstBarDate
          ? new Date(existingProgress.firstBarDate)
          : null;

      if (isIncrementalSync) {
        
      }

      // Calculate chunks
      const totalDays = Math.ceil((toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24));
      const totalChunks = Math.max(1, Math.ceil(totalDays / chunkDays));
      
      

      let totalBars = baseTotalBars;
      let barsSynced = 0;
      let chunksProcessed = 0;
      let firstBarDate: Date | null = preservedFirstBarDate;
      let lastBarDate: Date | null = existingProgress?.lastBarDate
        ? new Date(existingProgress.lastBarDate)
        : null;

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

        try {
          
          
          // Fetch bars from cTrader API (M1 only)
          const apiBars = await this.api.getBars(
            accessToken,
            symbol,
            "M1",
            chunkFrom,
            chunkTo,
            accountNumber
          );

          

          if (apiBars.length === 0) {
            chunksProcessed++;
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

            // For incremental sync, preserve firstBarDate (don't update it)
            // Only update firstBarDate for full syncs
            if (!isIncrementalSync) {
              if (!firstBarDate || chunkFirstDate < firstBarDate) {
                firstBarDate = chunkFirstDate;
              }
            }
            // Always update lastBarDate (it moves forward with new data)
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
          console.error(`[HybridSync] Failed to sync chunk ${chunk + 1}/${totalChunks}:`, error);
          
          await this.progressRepo.updateProgress(broker, symbol, {
            error: `Chunk ${chunk + 1} failed: ${errorMsg}`,
          });

          chunksProcessed++;
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
      

      // For incremental sync, ensure we preserve the original firstBarDate
      const finalFirstBarDate = isIncrementalSync && preservedFirstBarDate
        ? preservedFirstBarDate
        : firstBarDate;

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

