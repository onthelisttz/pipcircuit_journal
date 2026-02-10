import type { ITagRepository } from "@application/ports/repositories";
import type { Tag, TradeTag } from "@domain/entities";
import type { TagCategory } from "@domain/enums";
import { isOnline } from "@infrastructure/sync/utils/connection";

type TradeResolver = (dexieTradeId: number) => Promise<number | null>;
type TagResolver = (dexieTagId: number) => Promise<number | null>;

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

  private async syncToSupabase<T>(fn: () => Promise<T>): Promise<void> {
    if (this.supabase && isOnline()) {
      try {
        await fn();
      } catch (err) {
        console.warn("[DualTagRepo] Supabase sync failed (Dexie updated):", err);
      }
    }
  }

  async getById(id: number): Promise<Tag | null> {
    return this.dexie.getById(id);
  }

  async list(category?: TagCategory): Promise<Tag[]> {
    return this.dexie.list(category);
  }

  async create(tag: Tag): Promise<Tag> {
    const result = await this.dexie.create(tag);
    await this.syncToSupabase(async () => {
      if ("bulkUpsertTags" in (this.supabase as { bulkUpsertTags?: (t: Tag[]) => Promise<void> })) {
        await (this.supabase as { bulkUpsertTags: (t: Tag[]) => Promise<void> }).bulkUpsertTags([result]);
      }
    });
    return result;
  }

  async update(id: number, updates: Partial<Tag>): Promise<Tag> {
    const result = await this.dexie.update(id, updates);
    await this.syncToSupabase(async () => {
      if ("bulkUpsertTags" in (this.supabase as { bulkUpsertTags?: (t: Tag[]) => Promise<void> })) {
        await (this.supabase as { bulkUpsertTags: (t: Tag[]) => Promise<void> }).bulkUpsertTags([result]);
      }
    });
    return result;
  }

  async delete(id: number): Promise<void> {
    const tag = await this.dexie.getById(id);
    await this.dexie.delete(id);
    await this.syncToSupabase(async () => {
      if (tag && "getByNameAndCategory" in (this.supabase as { getByNameAndCategory?: (n: string, c: string) => Promise<{ id?: number } | null> })) {
        const supabaseTag = await (this.supabase as { getByNameAndCategory: (n: string, c: string) => Promise<{ id?: number } | null> }).getByNameAndCategory(tag.name, tag.category);
        if (supabaseTag?.id) await this.supabase!.delete(supabaseTag.id);
      } else {
        await this.supabase!.delete(id);
      }
    });
  }

  async listForTrade(tradeId: number): Promise<Tag[]> {
    return this.dexie.listForTrade(tradeId);
  }

  async addToTrade(tradeId: number, tagId: number): Promise<TradeTag> {
    const result = await this.dexie.addToTrade(tradeId, tagId);
    await this.syncToSupabase(async () => {
      const supabaseTradeId = this.resolveTradeId ? await this.resolveTradeId(tradeId) : null;
      const supabaseTagId = this.resolveTagId ? await this.resolveTagId(tagId) : null;
      if (supabaseTradeId != null && supabaseTagId != null) {
        await this.supabase!.addToTrade(supabaseTradeId, supabaseTagId);
      }
    });
    return result;
  }

  async removeFromTrade(tradeId: number, tagId: number): Promise<void> {
    await this.dexie.removeFromTrade(tradeId, tagId);
    await this.syncToSupabase(async () => {
      const supabaseTradeId = this.resolveTradeId ? await this.resolveTradeId(tradeId) : null;
      const supabaseTagId = this.resolveTagId ? await this.resolveTagId(tagId) : null;
      if (supabaseTradeId != null && supabaseTagId != null) {
        await this.supabase!.removeFromTrade(supabaseTradeId, supabaseTagId);
      }
    });
  }

  async replaceForTrade(tradeId: number, tagIds: number[]): Promise<void> {
    await this.dexie.replaceForTrade(tradeId, tagIds);
    await this.syncToSupabase(async () => {
      const supabaseTradeId = this.resolveTradeId ? await this.resolveTradeId(tradeId) : null;
      if (supabaseTradeId == null) return;
      const supabaseTagIds: number[] = [];
      for (const tid of tagIds) {
        const sid = this.resolveTagId ? await this.resolveTagId(tid) : null;
        if (sid != null) supabaseTagIds.push(sid);
      }
      await this.supabase!.replaceForTrade(supabaseTradeId, supabaseTagIds);
    });
  }
}
