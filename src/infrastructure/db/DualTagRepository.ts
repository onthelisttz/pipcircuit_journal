import type { ITagRepository } from "@application/ports/repositories";
import type { Tag, TradeTag } from "@domain/entities";
import type { TagCategory } from "@domain/enums";
import { isOnline } from "@infrastructure/sync/utils/connection";
import { EntitySyncQueue } from "@infrastructure/sync/EntitySyncQueue";

type TradeResolver = (dexieTradeId: number) => Promise<number | null>;
type TagResolver = (dexieTagId: number) => Promise<number | null>;

type TagLookupRepo = ITagRepository & {
  getByClientId: (clientId: string) => Promise<Tag | null>;
  getByNameAndCategory: (
    name: string,
    category: string
  ) => Promise<Tag | null>;
};

const hasGetByClientId = (
  repo: ITagRepository | null
): repo is TagLookupRepo =>
  Boolean(repo && typeof (repo as TagLookupRepo).getByClientId === "function");

const hasGetByNameAndCategory = (
  repo: ITagRepository | null
): repo is TagLookupRepo =>
  Boolean(
    repo && typeof (repo as TagLookupRepo).getByNameAndCategory === "function"
  );

/**
 * Dual repository: reads from Dexie, writes to Dexie + Supabase (when online).
 * Real-time sync for tags and trade-tag links. Resolves IDs for FK mapping.
 */
export class DualTagRepository implements ITagRepository {
  constructor(
    private readonly dexie: ITagRepository,
    private readonly supabase: ITagRepository | null,
    private readonly resolveTradeId: TradeResolver | null,
    private readonly resolveTagId: TagResolver | null
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
      console.warn("[DualTagRepo] Supabase sync failed (Dexie updated):", err);
      if (onFallback) await onFallback();
      return false;
    }
  }

  private async queueTradeTagsReplacement(tradeId: number): Promise<void> {
    const current = await this.dexie.listForTrade(tradeId);
    const tagIds = current.map((tag) => tag.id).filter((id): id is number => id != null);
    await EntitySyncQueue.queueTradeTagsReplace({ tradeId, tagIds });
  }

  async getById(id: number): Promise<Tag | null> {
    return this.dexie.getById(id);
  }

  async list(category?: TagCategory): Promise<Tag[]> {
    return this.dexie.list(category);
  }

  async create(tag: Tag): Promise<Tag> {
    const result = await this.dexie.create(tag);

    await this.syncToSupabase(
      async () => {
        let remote =
          result.clientId && hasGetByClientId(this.supabase)
            ? await this.supabase.getByClientId(result.clientId)
            : null;
        if (!remote && hasGetByNameAndCategory(this.supabase)) {
          remote = await this.supabase.getByNameAndCategory(result.name, result.category);
        }

        if (!remote) {
          remote = await this.supabase!.create(result);
        }

        if (result.id != null && remote?.id != null) {
          await this.dexie.update(result.id, {
            remoteId: remote.id,
            clientId: remote.clientId ?? result.clientId,
            updatedAt: remote.updatedAt,
            syncedAt: new Date(),
            deletedAt: remote.deletedAt ?? null,
            version: remote.version,
          });
        }
      },
      async () => {
        if (result.id != null) {
          await EntitySyncQueue.queueTagUpsert({ localId: result.id });
        }
      }
    );

    return result;
  }

  async update(id: number, updates: Partial<Tag>): Promise<Tag> {
    const previous = await this.dexie.getById(id);
    const result = await this.dexie.update(id, updates);

    await this.syncToSupabase(
      async () => {
        let remote =
          previous?.clientId && hasGetByClientId(this.supabase)
            ? await this.supabase.getByClientId(previous.clientId)
            : null;
        if (!remote && previous?.remoteId != null) {
          remote = await this.supabase!.getById(previous.remoteId);
        }

        if (!remote && previous && hasGetByNameAndCategory(this.supabase)) {
          remote = await this.supabase.getByNameAndCategory(
            previous.name,
            previous.category
          );
        }
        if (!remote && hasGetByNameAndCategory(this.supabase)) {
          remote = await this.supabase.getByNameAndCategory(result.name, result.category);
        }

        if (remote && remote.updatedAt > result.updatedAt) {
          await this.dexie.update(id, {
            ...remote,
            remoteId: remote.id,
          });
          return;
        }

        const synced = remote
          ? await this.supabase!.update(remote.id!, {
              clientId: result.clientId,
              name: result.name,
              category: result.category,
              color: result.color,
              updatedAt: result.updatedAt,
              deletedAt: null,
              version: result.version,
            })
          : await this.supabase!.create(result);

        await this.dexie.update(id, {
          remoteId: synced.id ?? synced.remoteId,
          clientId: synced.clientId ?? result.clientId,
          updatedAt: synced.updatedAt,
          syncedAt: new Date(),
          deletedAt: synced.deletedAt ?? null,
          version: synced.version,
        });
      },
      async () => {
        await EntitySyncQueue.queueTagUpsert({
          localId: id,
          previousName: previous?.name,
          previousCategory: previous?.category,
        });
      }
    );

    return result;
  }

  async delete(id: number): Promise<void> {
    const tag = await this.dexie.getById(id);
    await this.dexie.delete(id);

    await this.syncToSupabase(
      async () => {
        let remote = tag?.clientId && hasGetByClientId(this.supabase)
          ? await this.supabase.getByClientId(tag.clientId)
          : null;
        if (!remote && tag?.remoteId != null) {
          remote = await this.supabase!.getById(tag.remoteId);
        }
        if (!remote && tag && hasGetByNameAndCategory(this.supabase)) {
          remote = await this.supabase.getByNameAndCategory(tag.name, tag.category);
        }
        if (remote?.id != null) {
          await this.supabase!.delete(remote.id);
        }
      },
      async () => {
        await EntitySyncQueue.queueTagDelete(
          {
            localId: id,
            clientId: tag?.clientId,
            remoteId: tag?.remoteId,
            name: tag?.name,
            category: tag?.category,
          },
          id
        );
      }
    );
  }

  async listForTrade(tradeId: number): Promise<Tag[]> {
    return this.dexie.listForTrade(tradeId);
  }

  async addToTrade(tradeId: number, tagId: number): Promise<TradeTag> {
    const result = await this.dexie.addToTrade(tradeId, tagId);

    await this.syncToSupabase(
      async () => {
        const supabaseTradeId = this.resolveTradeId ? await this.resolveTradeId(tradeId) : null;
        const supabaseTagId = this.resolveTagId ? await this.resolveTagId(tagId) : null;
        if (supabaseTradeId != null && supabaseTagId != null) {
          await this.supabase!.addToTrade(supabaseTradeId, supabaseTagId);
        } else {
          throw new Error("Could not resolve cloud IDs for trade-tag add");
        }
      },
      async () => {
        await this.queueTradeTagsReplacement(tradeId);
      }
    );

    return result;
  }

  async removeFromTrade(tradeId: number, tagId: number): Promise<void> {
    await this.dexie.removeFromTrade(tradeId, tagId);

    await this.syncToSupabase(
      async () => {
        const supabaseTradeId = this.resolveTradeId ? await this.resolveTradeId(tradeId) : null;
        const supabaseTagId = this.resolveTagId ? await this.resolveTagId(tagId) : null;
        if (supabaseTradeId != null && supabaseTagId != null) {
          await this.supabase!.removeFromTrade(supabaseTradeId, supabaseTagId);
        } else {
          throw new Error("Could not resolve cloud IDs for trade-tag remove");
        }
      },
      async () => {
        await this.queueTradeTagsReplacement(tradeId);
      }
    );
  }

  async replaceForTrade(tradeId: number, tagIds: number[]): Promise<void> {
    await this.dexie.replaceForTrade(tradeId, tagIds);
    await this.syncToSupabase(
      async () => {
        const supabaseTradeId = this.resolveTradeId ? await this.resolveTradeId(tradeId) : null;
        if (supabaseTradeId == null) {
          throw new Error("Could not resolve cloud trade ID");
        }
        const supabaseTagIds: number[] = [];
        for (const tid of tagIds) {
          const sid = this.resolveTagId ? await this.resolveTagId(tid) : null;
          if (sid == null) {
            // Avoid partial cloud replacement when any tag is unresolved.
            // This forces queued retry, preserving consistency across devices.
            throw new Error(`Could not resolve cloud tag ID for local tag ${tid}`);
          }
          supabaseTagIds.push(sid);
        }
        await this.supabase!.replaceForTrade(supabaseTradeId, supabaseTagIds);
      },
      async () => {
        await EntitySyncQueue.queueTradeTagsReplace({ tradeId, tagIds });
      }
    );
  }
}
