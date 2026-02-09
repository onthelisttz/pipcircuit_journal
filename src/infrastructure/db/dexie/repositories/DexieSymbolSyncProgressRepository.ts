import type { ISymbolSyncProgressRepository } from "@application/ports/repositories";
import type { SymbolSyncProgress, SymbolSyncStatus } from "@domain/entities";
import { db } from "../database";

export class DexieSymbolSyncProgressRepository implements ISymbolSyncProgressRepository {
  async getByBrokerAndSymbol(
    broker: string,
    symbol: string
  ): Promise<SymbolSyncProgress | null> {
    try {
      console.log(`[DexieProgressRepo] getByBrokerAndSymbol called for ${broker}:${symbol}`);
      const result = await db.symbol_sync_progress
        .where("[broker+symbol]")
        .equals([broker, symbol])
        .first();
      console.log(`[DexieProgressRepo] getByBrokerAndSymbol result:`, result ? { id: result.id, status: result.status } : null);
      return result ?? null;
    } catch (err) {
      console.error(`[DexieProgressRepo] Error in getByBrokerAndSymbol for ${broker}:${symbol}:`, err);
      throw err;
    }
  }

  async getByBroker(broker: string): Promise<SymbolSyncProgress[]> {
    return db.symbol_sync_progress.where("broker").equals(broker).toArray();
  }

  async getAll(): Promise<SymbolSyncProgress[]> {
    try {
      console.log(`[DexieProgressRepo] getAll called`);
      const all = await db.symbol_sync_progress.toArray();
      console.log(`[DexieProgressRepo] getAll returned ${all.length} records`);
      return all;
    } catch (err) {
      console.error(`[DexieProgressRepo] Error in getAll:`, err);
      throw err;
    }
  }

  async getByStatus(status: SymbolSyncStatus): Promise<SymbolSyncProgress[]> {
    return db.symbol_sync_progress.where("status").equals(status).toArray();
  }

  async upsert(progress: SymbolSyncProgress): Promise<void> {
    // Find existing record by broker+symbol
    const existing = await this.getByBrokerAndSymbol(progress.broker, progress.symbol);

    if (existing?.id) {
      // Update existing record
      await db.symbol_sync_progress.update(existing.id, progress);
    } else {
      // Create new record
      await db.symbol_sync_progress.add(progress);
    }
  }

  async upsertMany(progresses: SymbolSyncProgress[]): Promise<void> {
    console.log(`[DexieProgressRepo] upsertMany called with ${progresses.length} records`);
    try {
      // Use transaction for batch operations
      await db.transaction("rw", db.symbol_sync_progress, async (tx) => {
        for (const progress of progresses) {
          try {
            // Use transaction table directly instead of calling getByBrokerAndSymbol
            const existing = await tx.symbol_sync_progress
              .where("[broker+symbol]")
              .equals([progress.broker, progress.symbol])
              .first();
            
            if (existing?.id) {
              console.log(`[DexieProgressRepo] Updating existing record ${existing.id} for ${progress.broker}:${progress.symbol}`);
              await tx.symbol_sync_progress.update(existing.id, progress);
            } else {
              console.log(`[DexieProgressRepo] Adding new record for ${progress.broker}:${progress.symbol}`, {
                broker: progress.broker,
                symbol: progress.symbol,
                status: progress.status,
                firstBarDate: progress.firstBarDate,
                lastBarDate: progress.lastBarDate,
              });
              const id = await tx.symbol_sync_progress.add(progress);
              console.log(`[DexieProgressRepo] Added record with id: ${id} for ${progress.broker}:${progress.symbol}`);
            }
          } catch (err) {
            console.error(`[DexieProgressRepo] Error upserting ${progress.broker}:${progress.symbol}:`, err);
            throw err; // Re-throw to abort transaction
          }
        }
      });
      console.log(`[DexieProgressRepo] upsertMany completed successfully for ${progresses.length} records`);
    } catch (err) {
      console.error(`[DexieProgressRepo] upsertMany failed:`, err);
      throw err;
    }
  }

  async updateStatus(
    broker: string,
    symbol: string,
    status: SymbolSyncStatus,
    error?: string | null
  ): Promise<void> {
    console.log(`[DexieProgressRepo] updateStatus called for ${broker}:${symbol}`, { status, error });
    try {
      // Use a transaction to ensure atomicity and avoid locks
      await db.transaction("rw", db.symbol_sync_progress, async () => {
        const existing = await db.symbol_sync_progress
          .where("[broker+symbol]")
          .equals([broker, symbol])
          .first();
        
        console.log(`[DexieProgressRepo] Found existing record:`, existing ? { id: existing.id, currentStatus: existing.status } : null);
        
        if (existing?.id) {
          console.log(`[DexieProgressRepo] Updating record ${existing.id} with status ${status}`);
          const updateData: Partial<SymbolSyncProgress> = {
            status,
            error: error ?? null,
          };
          
          if (status === "completed" || status === "failed") {
            updateData.lastSyncTime = new Date();
          }
          
          await db.symbol_sync_progress.update(existing.id, updateData);
          console.log(`[DexieProgressRepo] Update completed for ${broker}:${symbol}`);
        } else {
          console.warn(`[DexieProgressRepo] No existing record found for ${broker}:${symbol}, cannot update status`);
        }
      });
    } catch (err) {
      console.error(`[DexieProgressRepo] Error in updateStatus for ${broker}:${symbol}:`, err);
      throw err;
    }
  }

  async updateProgress(
    broker: string,
    symbol: string,
    updates: Partial<SymbolSyncProgress>
  ): Promise<void> {
    console.log(`[DexieProgressRepo] updateProgress called for ${broker}:${symbol}`, updates);
    try {
      await db.transaction("rw", db.symbol_sync_progress, async () => {
        const existing = await db.symbol_sync_progress
          .where("[broker+symbol]")
          .equals([broker, symbol])
          .first();
        
        console.log(`[DexieProgressRepo] Found existing record for updateProgress:`, existing ? { id: existing.id } : null);
        
        if (existing?.id) {
          console.log(`[DexieProgressRepo] Updating progress record ${existing.id}`);
          await db.symbol_sync_progress.update(existing.id, updates);
          console.log(`[DexieProgressRepo] Progress update completed`);
        } else {
          // Create new record if it doesn't exist
          console.log(`[DexieProgressRepo] Creating new progress record`);
          await db.symbol_sync_progress.add({
            broker,
            symbol,
            status: "pending",
            totalBars: 0,
            firstBarDate: null,
            lastBarDate: null,
            lastSyncTime: null,
            ...updates,
          });
          console.log(`[DexieProgressRepo] New progress record created`);
        }
      });
    } catch (err) {
      console.error(`[DexieProgressRepo] Error in updateProgress for ${broker}:${symbol}:`, err);
      throw err;
    }
  }

  async delete(broker: string, symbol: string): Promise<void> {
    const existing = await this.getByBrokerAndSymbol(broker, symbol);
    if (existing?.id) {
      await db.symbol_sync_progress.delete(existing.id);
    }
  }

  async deleteByBroker(broker: string): Promise<void> {
    await db.symbol_sync_progress.where("broker").equals(broker).delete();
  }
}
