import type { ISyncQueueRepository } from "@application/ports/repositories";
import type { SyncJob } from "@domain/entities";
import { SyncStatus } from "@domain/enums";
import { retry, type RetryOptions } from "./utils/retry";

export interface QueueProcessorOptions {
  /** Maximum concurrent jobs */
  concurrency?: number;
  /** Retry options for failed jobs */
  retryOptions?: RetryOptions;
  /** Callback when job completes */
  onJobComplete?: (job: SyncJob, success: boolean) => void;
  /** Callback when job fails */
  onJobError?: (job: SyncJob, error: Error) => void;
}

/**
 * SyncQueueManager - Manages sync queue operations
 *
 * Handles enqueueing, processing, and retrying sync jobs
 */
export class SyncQueueManager {
  private isProcessing: boolean = false;
  private processingJobs: Set<number> = new Set();

  constructor(
    private readonly syncQueueRepository: ISyncQueueRepository,
    private readonly processJob: (job: SyncJob) => Promise<void>
  ) {}

  /**
   * Enqueue a sync job
   */
  async enqueue(job: Omit<SyncJob, "id">): Promise<SyncJob> {
      const syncJob: SyncJob = {
        ...job,
        status: SyncStatus.Pending,
        timestamp: job.timestamp || new Date(),
        retryCount: 0,
      };

    return this.syncQueueRepository.enqueue(syncJob);
  }

  /**
   * Process the sync queue
   */
  async processQueue(options: QueueProcessorOptions = {}): Promise<void> {
    if (this.isProcessing) {
      return; // Already processing
    }

    this.isProcessing = true;

    try {
      const concurrency = options.concurrency || 1;
      const retryOptions = options.retryOptions || { maxAttempts: 3 };

      while (true) {
        // Get pending jobs
        const pendingJobs = await this.syncQueueRepository.listByStatus(SyncStatus.Pending);

        if (pendingJobs.length === 0) {
          break; // No more jobs
        }

        // Process jobs with concurrency limit
        const jobsToProcess = pendingJobs.slice(0, concurrency);
        const processingPromises = jobsToProcess.map((job) =>
          this.processJobWithRetry(job, retryOptions, options)
        );

        await Promise.allSettled(processingPromises);
      }
    } finally {
      this.isProcessing = false;
      this.processingJobs.clear();
    }
  }

  /**
   * Process a single job with retry logic
   */
  private async processJobWithRetry(
    job: SyncJob,
    retryOptions: RetryOptions,
    options: QueueProcessorOptions
  ): Promise<void> {
    if (this.processingJobs.has(job.id!)) {
      return; // Already processing
    }

    this.processingJobs.add(job.id!);

    try {
      // Mark as processing
      await this.syncQueueRepository.update(job.id!, { status: SyncStatus.Syncing });

      // Process with retry
      const result = await retry(
        async () => {
          await this.processJob(job);
        },
        retryOptions
      );

      if (result.success) {
        // Mark as completed
        await this.syncQueueRepository.update(job.id!, {
          status: SyncStatus.Synced,
          retryCount: result.attempts - 1,
        });

        options.onJobComplete?.(job, true);
      } else {
        // Check if we should retry again
        const newRetryCount = (job.retryCount || 0) + result.attempts;

        if (newRetryCount >= (retryOptions.maxAttempts || 5)) {
          // Mark as failed
          await this.syncQueueRepository.update(job.id!, {
            status: SyncStatus.Error,
            retryCount: newRetryCount,
          });

          options.onJobError?.(job, result.error || new Error("Unknown error"));
        } else {
          // Put back in queue for retry
          await this.syncQueueRepository.update(job.id!, {
            status: SyncStatus.Pending,
            retryCount: newRetryCount,
          });
        }
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      await this.syncQueueRepository.update(job.id!, {
        status: SyncStatus.Error,
      });
      options.onJobError?.(job, err);
    } finally {
      this.processingJobs.delete(job.id!);
    }
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(): Promise<{
    pending: number;
    processing: number;
    completed: number;
    failed: number;
  }> {
    const [pending, processing, completed, failed] = await Promise.all([
      this.syncQueueRepository.listByStatus(SyncStatus.Pending),
      this.syncQueueRepository.listByStatus(SyncStatus.Syncing),
      this.syncQueueRepository.listByStatus(SyncStatus.Synced),
      this.syncQueueRepository.listByStatus(SyncStatus.Error),
    ]);

    return {
      pending: pending.length,
      processing: processing.length,
      completed: completed.length,
      failed: failed.length,
    };
  }

  /**
   * Clear completed jobs (cleanup)
   */
  async clearCompleted(olderThanDays: number = 7): Promise<number> {
    const completed = await this.syncQueueRepository.listByStatus(SyncStatus.Synced);
    const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;

    const toDelete = completed.filter((job) => (job.timestamp || 0) < cutoff);
    await Promise.all(toDelete.map((job) => this.syncQueueRepository.delete(job.id!)));

    return toDelete.length;
  }

  /**
   * Retry failed jobs
   */
  async retryFailed(): Promise<number> {
    const failed = await this.syncQueueRepository.listByStatus(SyncStatus.Error);

    await Promise.all(
      failed.map((job) =>
        this.syncQueueRepository.update(job.id!, {
          status: SyncStatus.Pending,
          retryCount: 0,
        })
      )
    );

    return failed.length;
  }

  /**
   * Check if queue is currently processing
   */
  isQueueProcessing(): boolean {
    return this.isProcessing;
  }
}
