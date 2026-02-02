import type { SyncJob } from "@domain/entities";
import type { SyncStatus } from "@domain/enums";

export interface ISyncQueueRepository {
  getById(id: number): Promise<SyncJob | null>;
  listByStatus(status: SyncStatus): Promise<SyncJob[]>;
  enqueue(job: SyncJob): Promise<SyncJob>;
  update(id: number, updates: Partial<SyncJob>): Promise<SyncJob>;
  delete(id: number): Promise<void>;
  dequeueNext(): Promise<SyncJob | null>;
}
