import type { ChartBar } from "@domain/entities";
import type { SyncJob } from "@domain/entities/SyncJob";
import { db } from "@infrastructure/db/dexie/database";
import { SyncAction, SyncStatus } from "@domain/enums";
import { isOnline } from "./utils/connection";

/**
 * SupabaseSyncQueue
 * 
 * Manages retry queue for failed Supabase syncs.
 * Stores failed syncs in Dexie sync_queue table for later retry.
 */
export class SupabaseSyncQueue {
  private static readonly MAX_RETRIES = 5;
  private static readonly RETRY_DELAY_MS = 60000; // 1 minute

  /**
   * Queue bars for Supabase sync retry
   */
  static async queueForRetry(
    userId: string,
    broker: string,
    symbol: string,
    bars: ChartBar[],
    error?: string
  ): Promise<void> {
    try {
      // Store in sync_queue using SyncJob structure
      await db.sync_queue.add({
        action: SyncAction.Create, // Using Create action for chart bars
        table: "chart_bars",
        payload: {
          userId,
          broker,
          symbol,
          bars: bars.map(bar => ({
            broker: bar.broker,
            symbol: bar.symbol,
            timeframe: bar.timeframe,
            timestamp: bar.timestamp,
            open: bar.open,
            high: bar.high,
            low: bar.low,
            close: bar.close,
            volume: bar.volume,
          })),
          retryCount: 0,
          lastError: error,
        },
        timestamp: new Date(),
        retryCount: 0,
        status: SyncStatus.Pending,
        lastError: error || null,
      } as SyncJob);

      console.log(`[SupabaseSyncQueue] Queued ${bars.length} bars for ${broker}:${symbol} retry`);
    } catch (err) {
      console.error(`[SupabaseSyncQueue] Failed to queue retry:`, err);
    }
  }

  /**
   * Process queued Supabase syncs
   */
  static async processQueue(
    supabaseRepo: { upsertMany: (bars: ChartBar[]) => Promise<void> }
  ): Promise<{ processed: number; failed: number }> {
    if (!isOnline()) {
      console.log(`[SupabaseSyncQueue] Offline, skipping queue processing`);
      return { processed: 0, failed: 0 };
    }

    try {
      // Get pending chart_bars sync jobs (these are Supabase sync retries)
      // Use composite index [table+status] for efficient querying
      const pendingJobs = await db.sync_queue
        .where("[table+status]")
        .equals(["chart_bars", SyncStatus.Pending])
        .toArray();

      if (pendingJobs.length === 0) {
        return { processed: 0, failed: 0 };
      }

      console.log(`[SupabaseSyncQueue] Processing ${pendingJobs.length} queued syncs`);

      let processed = 0;
      let failed = 0;

      for (const job of pendingJobs) {
        try {
          const payload = job.payload as {
            userId: string;
            broker: string;
            symbol: string;
            bars: Array<{
              broker: string;
              symbol: string;
              timeframe: string;
              timestamp: number;
              open: number;
              high: number;
              low: number;
              close: number;
              volume: number;
            }>;
            retryCount: number;
            lastError?: string;
          };

          if (!payload || !payload.bars) {
            console.warn(`[SupabaseSyncQueue] Invalid payload for job ${job.id}, skipping`);
            await db.sync_queue.delete(job.id!);
            continue;
          }

          const retryCount = (job.retryCount || 0) + 1;

          if (retryCount > this.MAX_RETRIES) {
            console.warn(
              `[SupabaseSyncQueue] Max retries reached for ${payload.broker}:${payload.symbol}, marking as failed`
            );
            await db.sync_queue.update(job.id!, {
              status: SyncStatus.Error,
              retryCount,
            });
            failed++;
            continue;
          }

          // Mark as syncing
          await db.sync_queue.update(job.id!, {
            status: SyncStatus.Syncing,
            retryCount,
          });

          // Convert payload bars back to ChartBar format
          const chartBars: ChartBar[] = payload.bars.map(bar => ({
            broker: bar.broker,
            symbol: bar.symbol,
            timeframe: bar.timeframe as any,
            timestamp: bar.timestamp,
            open: bar.open,
            high: bar.high,
            low: bar.low,
            close: bar.close,
            volume: bar.volume,
            syncedAt: null,
          }));

          // Try to sync to Supabase
          await supabaseRepo.upsertMany(chartBars);

          // Success - remove from queue
          await db.sync_queue.delete(job.id!);
          console.log(
            `[SupabaseSyncQueue] Successfully synced ${chartBars.length} bars for ${payload.broker}:${payload.symbol}`
          );
          processed++;

          // Small delay between syncs
          await new Promise((resolve) => setTimeout(resolve, 500));
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          console.error(`[SupabaseSyncQueue] Failed to process job ${job.id}:`, error);

          const retryCount = (job.retryCount || 0) + 1;

          if (retryCount >= this.MAX_RETRIES) {
            // Max retries reached, mark as failed
            await db.sync_queue.update(job.id!, {
              status: SyncStatus.Error,
              retryCount,
              lastError: errorMsg,
            });
            failed++;
          } else {
            // Put back in queue for retry
            await db.sync_queue.update(job.id!, {
              status: SyncStatus.Pending,
              retryCount,
              lastError: errorMsg,
            });
          }
        }
      }

      return { processed, failed };
    } catch (error) {
      console.error(`[SupabaseSyncQueue] Error processing queue:`, error);
      return { processed: 0, failed: 0 };
    }
  }

  /**
   * Get queue statistics
   */
  static async getQueueStats(): Promise<{
    pending: number;
    processing: number;
    failed: number;
  }> {
    try {
      // Get all chart_bars sync jobs
      const allJobs = await db.sync_queue
        .where("table")
        .equals("chart_bars")
        .toArray();

      return {
        pending: allJobs.filter((j: SyncJob) => j.status === SyncStatus.Pending).length,
        processing: allJobs.filter((j: SyncJob) => j.status === SyncStatus.Syncing).length,
        failed: allJobs.filter((j: SyncJob) => j.status === SyncStatus.Error).length,
      };
    } catch (error) {
      console.error(`[SupabaseSyncQueue] Error getting stats:`, error);
      return { pending: 0, processing: 0, failed: 0 };
    }
  }
}
