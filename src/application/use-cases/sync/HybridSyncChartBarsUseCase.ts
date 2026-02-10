import type { ICTraderAPI } from "@application/ports/services";
import type { IChartBarRepository, ISymbolSyncProgressRepository } from "@application/ports/repositories";
import type { ChartBar, SymbolSyncProgress, SymbolSyncStatus } from "@domain/entities";
import { CTRADER_M1_MAX_CHUNK_DAYS } from "@config/ctrader";
import { CTraderMapper } from "@infrastructure/api/ctrader/CTraderMapper";
import { isOnline } from "@infrastructure/sync/utils/connection";
import { progressEventEmitter } from "@infrastructure/sync/ProgressEventEmitter";
import { SupabaseSyncQueue } from "@infrastructure/sync/SupabaseSyncQueue";

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
  /** Force full sync from cTrader (skip Supabase check) */
  forceFullSync?: boolean;
  /** Callback for progress updates */
  onProgress?: (progress: {
    chunk: number;
    totalChunks: number;
    barsSynced: number;
    progressPercent: number;
    source: "dexie" | "supabase" | "ctrader";
  }) => void;
  /** Check if sync should be cancelled */
  shouldCancel?: () => boolean;
}

export interface HybridSyncChartBarsResult {
  success: boolean;
  totalBars: number;
  barsSynced: number;
  chunksProcessed: number;
  source: "dexie" | "supabase" | "ctrader";
  error?: string;
}

/**
 * HybridSyncChartBarsUseCase
 *
 * Implements hybrid sync strategy:
 * 1. Check Dexie (local) first → if data exists, use it
 * 2. If Dexie is empty → check Supabase → if data exists, sync to Dexie
 * 3. If Supabase is empty → fetch from cTrader API
 * 4. For incremental updates: Check last sync timestamp, fetch only new data
 * 5. Store in Dexie first (offline-first), then sync to Supabase
 */
export class HybridSyncChartBarsUseCase {
  constructor(
    private readonly api: ICTraderAPI,
    private readonly dexieChartBarRepo: IChartBarRepository,
    private readonly supabaseChartBarRepo: IChartBarRepository,
    private readonly progressRepo: ISymbolSyncProgressRepository
  ) {}

  async execute(params: HybridSyncChartBarsParams): Promise<HybridSyncChartBarsResult> {
    const {
      userId,
      broker,
      symbol,
      fromDate,
      toDate,
      accessToken,
      accountNumber,
      chunkDays = CTRADER_M1_MAX_CHUNK_DAYS,
      forceFullSync = false,
      onProgress,
      shouldCancel,
    } = params;

    console.log(`[HybridSync] Starting hybrid sync for ${broker}:${symbol}`, {
      userId,
      fromDate: fromDate.toISOString(),
      toDate: toDate.toISOString(),
      accountNumber,
      forceFullSync,
    });

    try {
      // Step 1: Check Dexie first (local)
      console.log(`[HybridSync] Step 1: Checking Dexie for existing bars...`);
      const dexieBars = await this.dexieChartBarRepo.getByWindow(
        symbol,
        "M1",
        fromDate.getTime(),
        toDate.getTime(),
        broker
      );

      if (dexieBars.length > 0 && !forceFullSync) {
        console.log(`[HybridSync] Found ${dexieBars.length} bars in Dexie, using local data`);
        
        // Check if we need incremental update (check last sync timestamp)
        const progress = await this.progressRepo.getByBrokerAndSymbol(broker, symbol);
        const needsIncrementalUpdate = progress?.lastSyncTime 
          ? new Date(progress.lastSyncTime) < toDate
          : false;

        if (!needsIncrementalUpdate) {
          console.log(`[HybridSync] Dexie has complete data, no sync needed`);
          return {
            success: true,
            totalBars: dexieBars.length,
            barsSynced: 0,
            chunksProcessed: 0,
            source: "dexie",
          };
        }

        // Need incremental update - fetch only new data from cTrader
        console.log(`[HybridSync] Dexie has data but needs incremental update`);
        const lastSyncTime = progress?.lastSyncTime ? new Date(progress.lastSyncTime) : fromDate;
        return await this.syncFromCTrader(
          {
            ...params,
            fromDate: lastSyncTime > fromDate ? lastSyncTime : fromDate,
          },
          "ctrader"
        );
      }

      // Step 2: Dexie is empty, check Supabase
      if (isOnline() && !forceFullSync) {
        console.log(`[HybridSync] Step 2: Dexie empty, checking Supabase...`);
        try {
          const supabaseBars = await this.supabaseChartBarRepo.getByWindow(
            symbol,
            "M1",
            fromDate.getTime(),
            toDate.getTime(),
            broker
          );

          if (supabaseBars.length > 0) {
            console.log(`[HybridSync] Found ${supabaseBars.length} bars in Supabase, syncing to Dexie...`);
            
            // Sync Supabase bars to Dexie
            await this.dexieChartBarRepo.upsertMany(supabaseBars);
            console.log(`[HybridSync] Synced ${supabaseBars.length} bars from Supabase to Dexie`);

            // Check if we need incremental update
            const progress = await this.progressRepo.getByBrokerAndSymbol(broker, symbol);
            const needsIncrementalUpdate = progress?.lastSyncTime 
              ? new Date(progress.lastSyncTime) < toDate
              : true;

            if (!needsIncrementalUpdate) {
              console.log(`[HybridSync] Supabase has complete data, sync complete`);
              return {
                success: true,
                totalBars: supabaseBars.length,
                barsSynced: supabaseBars.length,
                chunksProcessed: 1,
                source: "supabase",
              };
            }

            // Need incremental update - fetch only new data from cTrader
            console.log(`[HybridSync] Supabase has data but needs incremental update`);
            const lastSyncTime = progress?.lastSyncTime ? new Date(progress.lastSyncTime) : fromDate;
            return await this.syncFromCTrader(
              {
                ...params,
                fromDate: lastSyncTime > fromDate ? lastSyncTime : fromDate,
              },
              "ctrader"
            );
          }
        } catch (error) {
          console.warn(`[HybridSync] Failed to check Supabase, falling back to cTrader:`, error);
        }
      }

      // Step 3: Both Dexie and Supabase are empty, fetch from cTrader
      console.log(`[HybridSync] Step 3: Both Dexie and Supabase empty, fetching from cTrader API...`);
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
   * Sync from cTrader API (original sync logic)
   */
  private async syncFromCTrader(
    params: HybridSyncChartBarsParams,
    source: "ctrader"
  ): Promise<HybridSyncChartBarsResult> {
    const {
      userId,
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

    console.log(`[HybridSync] Syncing from cTrader API for ${symbol}`);

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

      let baseTotalBars = isIncrementalSync && existingProgress ? existingProgress.totalBars : 0;
      let preservedFirstBarDate: Date | null =
        isIncrementalSync && existingProgress?.firstBarDate
          ? new Date(existingProgress.firstBarDate)
          : null;

      if (isIncrementalSync) {
        console.log(`[HybridSync] Incremental sync - preserving firstBarDate, baseTotalBars=${baseTotalBars}`);
      }

      // Calculate chunks
      const totalDays = Math.ceil((toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24));
      const totalChunks = Math.max(1, Math.ceil(totalDays / chunkDays));
      
      console.log(`[HybridSync] Calculated ${totalChunks} chunks for ${totalDays} days`);

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
          console.log(`[HybridSync] Fetching bars for ${symbol} from ${new Date(chunkFrom).toISOString()} to ${new Date(chunkTo).toISOString()}`);
          
          // Fetch bars from cTrader API (M1 only)
          const apiBars = await this.api.getBars(
            accessToken,
            symbol,
            "M1",
            chunkFrom,
            chunkTo,
            accountNumber
          );

          console.log(`[HybridSync] Received ${apiBars.length} bars for ${symbol} chunk ${chunk + 1}/${totalChunks}`);

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

          // Parallel storage: Store in Dexie immediately (fast, offline-first)
          // and sync to Supabase in parallel (cloud backup)
          console.log(`[HybridSync] Storing ${chartBars.length} bars in parallel (Dexie + Supabase)...`);
          
          const storagePromises = [
            // Dexie storage (always, fast, offline-first)
            this.dexieChartBarRepo.upsertMany(chartBars).then(() => {
              console.log(`[HybridSync] Bars stored in Dexie`);
            }),
            
            // Supabase sync (if online, can fail gracefully)
            isOnline()
              ? this.supabaseChartBarRepo.upsertMany(chartBars)
                  .then(() => {
                    console.log(`[HybridSync] Bars synced to Supabase`);
                  })
                  .catch(async (error) => {
                    const errorMsg = error instanceof Error ? error.message : String(error);
                    console.warn(`[HybridSync] Failed to sync to Supabase, queueing for retry:`, errorMsg);
                    
                    // Queue for retry - data is already in Dexie, so user can continue
                    await SupabaseSyncQueue.queueForRetry(
                      userId,
                      broker,
                      symbol,
                      chartBars,
                      errorMsg
                    );
                  })
              : Promise.resolve(),
          ];

          // Wait for both to complete (Dexie will succeed, Supabase may fail)
          await Promise.allSettled(storagePromises);
          console.log(`[HybridSync] Parallel storage completed`);

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
      console.log(`[HybridSync] Recalculated totalBars from Dexie: ${actualTotalBars} (was ${totalBars})`);

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

      console.log(`[HybridSync] Final dates - firstBarDate: ${finalFirstBarDateFromDexie?.toISOString()}, lastBarDate: ${finalLastBarDate?.toISOString()}`);

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
