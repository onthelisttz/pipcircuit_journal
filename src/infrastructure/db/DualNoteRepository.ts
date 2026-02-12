import type { INoteRepository } from "@application/ports/repositories";
import type { TradeNote } from "@domain/entities";
import { isOnline } from "@infrastructure/sync/utils/connection";
import { EntitySyncQueue } from "@infrastructure/sync/EntitySyncQueue";

type TradeResolver = (dexieTradeId: number) => Promise<number | null>;
type NoteLookupRepo = INoteRepository & {
  getByClientId: (clientId: string) => Promise<TradeNote | null>;
  findByTradeAndCreatedAt: (tradeId: number, createdAt: Date) => Promise<TradeNote | null>;
};

const hasGetByClientId = (
  repo: INoteRepository | null
): repo is NoteLookupRepo =>
  Boolean(repo && typeof (repo as NoteLookupRepo).getByClientId === "function");

const hasFindByTradeAndCreatedAt = (
  repo: INoteRepository | null
): repo is NoteLookupRepo =>
  Boolean(
    repo &&
      typeof (repo as NoteLookupRepo).findByTradeAndCreatedAt === "function"
  );

/**
 * Dual repository: reads from Dexie, writes to Dexie + Supabase (when online).
 * Real-time sync for trade notes. Resolves Dexie trade id to Supabase trade id for FK.
 */
export class DualNoteRepository implements INoteRepository {
  constructor(
    private readonly dexie: INoteRepository,
    private readonly supabase: INoteRepository | null,
    private readonly resolveTradeId: TradeResolver | null
  ) {}

  private async syncToSupabase<T>(
    fn: () => Promise<T>,
    onFallback?: () => Promise<void>
  ): Promise<boolean> {
    if (!this.supabase || !isOnline()) {
      if (onFallback) await onFallback();
      return false;
    }

    try {
      await fn();
      return true;
    } catch (err) {
      console.warn("[DualNoteRepo] Supabase sync failed (Dexie updated):", err);
      if (onFallback) await onFallback();
      return false;
    }
  }

  private async resolveRemoteNote(note: TradeNote): Promise<TradeNote | null> {
    if (!this.supabase) return null;
    if (note.clientId && hasGetByClientId(this.supabase)) {
      const byClient = await this.supabase.getByClientId(note.clientId);
      if (byClient) return byClient;
    }
    if (note.remoteId != null) {
      const byId = await this.supabase.getById(note.remoteId);
      if (byId) return byId;
    }

    if (this.resolveTradeId && hasFindByTradeAndCreatedAt(this.supabase)) {
      const supabaseTradeId = await this.resolveTradeId(note.tradeId);
      if (supabaseTradeId != null) {
        return this.supabase.findByTradeAndCreatedAt(
          supabaseTradeId,
          note.createdAt instanceof Date ? note.createdAt : new Date(note.createdAt)
        );
      }
    }
    return null;
  }

  async getById(id: number): Promise<TradeNote | null> {
    return this.dexie.getById(id);
  }

  async listByTradeId(tradeId: number): Promise<TradeNote[]> {
    return this.dexie.listByTradeId(tradeId);
  }

  async create(note: TradeNote): Promise<TradeNote> {
    const result = await this.dexie.create(note);

    await this.syncToSupabase(
      async () => {
        const supabaseTradeId = this.resolveTradeId
          ? await this.resolveTradeId(note.tradeId)
          : null;
        if (supabaseTradeId == null) {
          throw new Error("Could not resolve cloud trade ID for note create");
        }

        const remote = await this.supabase!.create({
          ...result,
          tradeId: supabaseTradeId,
          deletedAt: null,
        });
        if (result.id != null) {
          await this.dexie.update(result.id, {
            remoteId: remote.id ?? remote.remoteId,
            clientId: remote.clientId ?? result.clientId,
            syncedAt: new Date(),
            updatedAt: remote.updatedAt,
            deletedAt: remote.deletedAt ?? null,
            version: remote.version,
          });
        }
      },
      async () => {
        if (result.id != null) {
          await EntitySyncQueue.queueNoteUpsert({ localId: result.id });
        }
      }
    );

    return result;
  }

  async update(id: number, updates: Partial<TradeNote>): Promise<TradeNote> {
    const result = await this.dexie.update(id, updates);

    await this.syncToSupabase(
      async () => {
        const supabaseTradeId = this.resolveTradeId
          ? await this.resolveTradeId(result.tradeId)
          : null;
        if (supabaseTradeId == null) {
          throw new Error("Could not resolve cloud trade ID for note update");
        }

        const remote = await this.resolveRemoteNote(result);

        if (remote && remote.updatedAt > result.updatedAt) {
          await this.dexie.update(id, {
            content: remote.content,
            updatedAt: remote.updatedAt,
            syncedAt: remote.syncedAt,
            version: remote.version,
            remoteId: remote.id ?? remote.remoteId,
          });
          return;
        }

        const synced = remote
          ? await this.supabase!.update(remote.id!, {
              clientId: result.clientId,
              content: result.content,
              updatedAt: result.updatedAt,
              syncedAt: new Date(),
              deletedAt: null,
              version: result.version,
            })
          : await this.supabase!.create({
              ...result,
              tradeId: supabaseTradeId,
              deletedAt: null,
            });

        await this.dexie.update(id, {
          remoteId: synced.id ?? synced.remoteId,
          clientId: synced.clientId ?? result.clientId,
          syncedAt: new Date(),
          updatedAt: synced.updatedAt,
          deletedAt: synced.deletedAt ?? null,
          version: synced.version,
        });
      },
      async () => {
        await EntitySyncQueue.queueNoteUpsert({ localId: id });
      }
    );

    return result;
  }

  async delete(id: number): Promise<void> {
    const local = await this.dexie.getById(id);
    await this.dexie.delete(id);

    await this.syncToSupabase(
      async () => {
        if (!local) return;
        const remote = await this.resolveRemoteNote(local);
        if (remote?.id != null) {
          await this.supabase!.delete(remote.id);
        }
      },
      async () => {
        await EntitySyncQueue.queueNoteDelete(
          {
            localId: id,
            clientId: local?.clientId,
            remoteId: local?.remoteId,
            localTradeId: local?.tradeId,
            createdAt:
              local?.createdAt instanceof Date
                ? local.createdAt.toISOString()
                : local?.createdAt
                ? new Date(local.createdAt).toISOString()
                : undefined,
          },
          id
        );
      }
    );
  }
}
