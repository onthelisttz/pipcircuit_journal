import type { ICTraderAPI } from "@application/ports/services";
import type { IChartBarRepository, ISymbolSyncProgressRepository } from "@application/ports/repositories";
import type { ChartBar, SymbolSyncProgress, SymbolSyncStatus } from "@domain/entities";
import { CTRADER_M1_MAX_CHUNK_DAYS } from "@config/ctrader";
import { CTraderMapper } from "@infrastructure/api/ctrader/CTraderMapper";
import { isOnline } from "@infrastructure/sync/utils/connection";
import { progressEventEmitter } from "@infrastructure/sync/ProgressEventEmitter";

export interface SyncChartBarsParams {
  userId: string;
  broker: string;
  symbol: string;
  fromDate: Date;
  toDate: Date;
  accessToken: string;
  accountNumber?: string;
  /** Chunk size in days (default: 9 for M1 - cTrader API limit is 14k bars/request) */
  chunkDays?: number;
  /** Callback for progress updates */
  onProgress?: (progress: {
    chunk: number;
    totalChunks: number;
    barsSynced: number;
    progressPercent: number;
  }) => void;
  /** Check if sync should be cancelled */
  shouldCancel?: () => boolean;
}

export interface SyncChartBarsResult {
  success: boolean;
  totalBars: number;
  barsSynced: number;
  chunksProcessed: number;
  error?: string;
}

/**
 * SyncChartBarsForSymbolUseCase
 *
 * Syncs M1 chart bars for a symbol in chunks:
 * - Fetches bars from cTrader API in 9-day chunks (cTrader limit: 14k bars/request)
 * - Adds broker field to bars
 * - Stores in Dexie (local)
 * - Syncs to Supabase if online
 * - Updates progress after each chunk
 */
export class SyncChartBarsForSymbolUseCase {
  constructor(
    private readonly api: ICTraderAPI,
    private readonly dexieChartBarRepo: IChartBarRepository,
    private readonly supabaseChartBarRepo: IChartBarRepository,
    private readonly progressRepo: ISymbolSyncProgressRepository
  ) {}

  async execute(params: SyncChartBarsParams): Promise<SyncChartBarsResult> {
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

    

    // Update status to syncing with timeout protection
    
    try {
      await Promise.race([
        this.progressRepo.updateStatus(broker, symbol, "syncing" as SymbolSyncStatus),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error("updateStatus timeout after 5 seconds")), 5000)
        )
      ]);
      
    } catch (statusError) {
      console.error(`[SyncChartBars] Failed to update status to syncing:`, statusError);
      // Continue anyway - the sync can proceed even if status update fails
      
    }

    try {
      // Calculate chunks
      const totalDays = Math.ceil((toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24));
      const totalChunks = Math.ceil(totalDays / chunkDays);
      
      

      let totalBars = 0;
      let barsSynced = 0;
      let chunksProcessed = 0;
      let firstBarDate: Date | null = null;
      let lastBarDate: Date | null = null;

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
              broker, // Add broker identifier
              syncedAt: new Date(), // Mark as synced
            };
          });
          

          // Update first/last bar dates
          
          const sortedBars = chartBars.sort((a, b) => a.timestamp - b.timestamp);
          if (sortedBars.length > 0) {
            const chunkFirstDate = new Date(sortedBars[0].timestamp);
            const chunkLastDate = new Date(sortedBars[sortedBars.length - 1].timestamp);

            if (!firstBarDate || chunkFirstDate < firstBarDate) {
              firstBarDate = chunkFirstDate;
            }
            if (!lastBarDate || chunkLastDate > lastBarDate) {
              lastBarDate = chunkLastDate;
            }
          }
          

          // Store in Dexie (always)
          
          await this.dexieChartBarRepo.upsertMany(chartBars);
          

          // Sync to Supabase if online
          if (isOnline()) {
            try {
              
              await this.supabaseChartBarRepo.upsertMany(chartBars);
              
            } catch (error) {
              console.warn(`[SyncChartBars] Failed to sync to Supabase (continuing with local):`, error);
              // Continue even if Supabase sync fails
            }
          } else {
            
          }

          totalBars += chartBars.length;
          barsSynced += chartBars.length;
          chunksProcessed++;

          // Update progress
          const progressPercent = Math.round((chunksProcessed / totalChunks) * 100);
          
          
          // Get current progress record
          const currentProgress = await this.progressRepo.getByBrokerAndSymbol(broker, symbol);
          
          const updatedProgress: SymbolSyncProgress = {
            broker,
            symbol,
            status: "syncing" as SymbolSyncStatus,
            totalBars,
            firstBarDate,
            lastBarDate,
            lastSyncTime: null,
            progressPercent,
            error: null,
            ...currentProgress,
          };
          
          
          await this.progressRepo.updateProgress(broker, symbol, {
            totalBars,
            firstBarDate,
            lastBarDate,
            progressPercent,
          });
          

          // Emit progress event for store updates
          
          progressEventEmitter.emit(updatedProgress);
          

          // Notify progress callback
          onProgress?.({
            chunk: chunksProcessed,
            totalChunks,
            barsSynced,
            progressPercent,
          });

          // Small delay to avoid rate limiting
          await new Promise((resolve) => setTimeout(resolve, 100));
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          console.error(`[SyncChartBars] Failed to sync chunk ${chunk + 1}/${totalChunks} for ${symbol}:`, error);
          console.error(`[SyncChartBars] Error details:`, {
            error: errorMsg,
            stack: error instanceof Error ? error.stack : undefined,
            chunkFrom: new Date(chunkFrom).toISOString(),
            chunkTo: new Date(chunkTo).toISOString(),
          });

          // Update progress with error but continue
          await this.progressRepo.updateProgress(broker, symbol, {
            error: `Chunk ${chunk + 1} failed: ${errorMsg}`,
          });

          // Continue with next chunk
          chunksProcessed++;
        }
      }

      // Final progress update - update status and all fields together
      const finalProgress: SymbolSyncProgress = {
        broker,
        symbol,
        status: "completed" as SymbolSyncStatus,
        totalBars,
        firstBarDate,
        lastBarDate,
        lastSyncTime: new Date(),
        progressPercent: 100,
        error: null,
      };
      
      // Update status first
      await this.progressRepo.updateStatus(
        broker,
        symbol,
        "completed" as SymbolSyncStatus
      );

      // Then update all progress fields
      await this.progressRepo.updateProgress(broker, symbol, {
        totalBars,
        firstBarDate,
        lastBarDate,
        lastSyncTime: finalProgress.lastSyncTime,
        progressPercent: 100,
        error: null,
      });

      // Get the updated record to ensure we have the ID
      const updatedProgress = await this.progressRepo.getByBrokerAndSymbol(broker, symbol);
      if (updatedProgress) {
        // Emit final progress event with complete data
        progressEventEmitter.emit(updatedProgress);
      }

      return {
        success: true,
        totalBars,
        barsSynced,
        chunksProcessed,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      
      // Mark as failed
      await this.progressRepo.updateStatus(
        broker,
        symbol,
        "failed" as SymbolSyncStatus,
        errorMsg
      );

      // Emit failed progress event
      const failedProgress = await this.progressRepo.getByBrokerAndSymbol(broker, symbol);
      if (failedProgress) {
        progressEventEmitter.emit(failedProgress);
      }

      return {
        success: false,
        totalBars: 0,
        barsSynced: 0,
        chunksProcessed: 0,
        error: errorMsg,
      };
    }
  }
}
