import type { ITagRepository } from "@application/ports/repositories";
import type { Tag, TradeTag } from "@domain/entities";
import type { TagCategory } from "@domain/enums";
import { db } from "../database";

export class DexieTagRepository implements ITagRepository {
  async getById(id: number): Promise<Tag | null> {
    return (await db.tags.get(id)) ?? null;
  }

  async list(category?: TagCategory): Promise<Tag[]> {
    if (!category) {
      return db.tags.toArray();
    }
    return db.tags.where("category").equals(category).toArray();
  }

  async create(tag: Tag): Promise<Tag> {
    const id = await db.tags.add(tag);
    return { ...tag, id };
  }

  async update(id: number, updates: Partial<Tag>): Promise<Tag> {
    await db.tags.update(id, updates);
    const updated = await db.tags.get(id);
    if (!updated) {
      throw new Error(`Tag not found: ${id}`);
    }
    return updated;
  }

  async delete(id: number): Promise<void> {
    await db.tags.delete(id);
  }

  async listForTrade(tradeId: number): Promise<Tag[]> {
    const tradeTags = await db.trade_tags.where("tradeId").equals(tradeId).toArray();
    const tagIds = tradeTags.map((entry) => entry.tagId);
    if (tagIds.length === 0) {
      return [];
    }
    const tags = await db.tags.bulkGet(tagIds);
    return tags.filter((tag): tag is Tag => Boolean(tag));
  }

  async addToTrade(tradeId: number, tagId: number): Promise<TradeTag> {
    const tradeTag: TradeTag = {
      tradeId,
      tagId,
      createdAt: new Date(),
    };
    const id = await db.trade_tags.add(tradeTag);
    return { ...tradeTag, id };
  }

  async removeFromTrade(tradeId: number, tagId: number): Promise<void> {
    const record = await db.trade_tags
      .where("[tradeId+tagId]")
      .equals([tradeId, tagId])
      .first();
    if (record?.id) {
      await db.trade_tags.delete(record.id);
    }
  }

  async replaceForTrade(tradeId: number, tagIds: number[]): Promise<void> {
    await db.transaction("rw", db.trade_tags, async () => {
      await db.trade_tags.where("tradeId").equals(tradeId).delete();
      if (tagIds.length === 0) {
        return;
      }
      const records: TradeTag[] = tagIds.map((tagId) => ({
        tradeId,
        tagId,
        createdAt: new Date(),
      }));
      await db.trade_tags.bulkAdd(records);
    });
  }
}
