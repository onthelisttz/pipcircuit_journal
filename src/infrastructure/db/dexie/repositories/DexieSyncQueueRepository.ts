import type { ISyncQueueRepository } from "@application/ports/repositories";
import type { SyncJob } from "@domain/entities";
import { SyncStatus } from "@domain/enums";
import { db } from "../database";

export class DexieSyncQueueRepository implements ISyncQueueRepository {
  async getById(id: number): Promise<SyncJob | null> {
    return (await db.sync_queue.get(id)) ?? null;
  }

  async listByStatus(status: SyncStatus): Promise<SyncJob[]> {
    return db.sync_queue.where("status").equals(status).toArray();
  }

  async enqueue(job: SyncJob): Promise<SyncJob> {
    const id = await db.sync_queue.add(job);
    return { ...job, id };
  }

  async update(id: number, updates: Partial<SyncJob>): Promise<SyncJob> {
    await db.sync_queue.update(id, updates);
    const updated = await db.sync_queue.get(id);
    if (!updated) {
      throw new Error(`Sync job not found: ${id}`);
    }
    return updated;
  }

  async delete(id: number): Promise<void> {
    await db.sync_queue.delete(id);
  }

  async dequeueNext(): Promise<SyncJob | null> {
    const pending = await db.sync_queue
      .where("status")
      .equals(SyncStatus.Pending)
      .sortBy("timestamp");
    return pending[0] ?? null;
  }
}
