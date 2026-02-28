import type { ITagRepository } from "@application/ports/repositories";
import type { Tag, TradeTag } from "@domain/entities";
import { TagCategory } from "@domain/enums";
import { createUuid, getOrCreateDeviceId } from "@infrastructure/sync/utils";
import { db } from "../database";

function now(): Date {
  return new Date();
}

function incrementVersion(current?: number): number {
  return (current ?? 1) + 1;
}

const DEFAULT_TAG_NAME = "Untitled";
const DEFAULT_TAG_COLOR = "#6b7280";
const TAG_CATEGORIES = new Set<TagCategory>(Object.values(TagCategory));

function sanitizeTagName(name: unknown): string {
  const value = typeof name === "string" ? name.trim() : "";
  return value.length > 0 ? value : DEFAULT_TAG_NAME;
}

function sanitizeTagCategory(category: unknown): TagCategory {
  return TAG_CATEGORIES.has(category as TagCategory)
    ? (category as TagCategory)
    : TagCategory.Custom;
}

function sanitizeTagColor(color: unknown): string {
  const value = typeof color === "string" ? color.trim() : "";
  return value.length > 0 ? value : DEFAULT_TAG_COLOR;
}

function normalizeTagName(name: unknown): string {
  return sanitizeTagName(name).toLowerCase();
}

function normalizeStoredTag(tag: Tag): Tag {
  return {
    ...tag,
    name: sanitizeTagName(tag.name),
    category: sanitizeTagCategory(tag.category),
    color: sanitizeTagColor(tag.color),
  };
}

export class DexieTagRepository implements ITagRepository {
  async getById(id: number): Promise<Tag | null> {
    const row = await db.tags.get(id);
    if (!row || row.deletedAt) return null;
    return normalizeStoredTag(row);
  }

  async getByIdIncludingDeleted(id: number): Promise<Tag | null> {
    const row = await db.tags.get(id);
    return row ? normalizeStoredTag(row) : null;
  }

  async getByRemoteId(remoteId: number, includeDeleted = false): Promise<Tag | null> {
    const tag = await db.tags.where("remoteId").equals(remoteId).first();
    if (!tag) return null;
    if (!includeDeleted && tag.deletedAt) return null;
    return normalizeStoredTag(tag);
  }

  async getByClientId(clientId: string, includeDeleted = false): Promise<Tag | null> {
    const tag = await db.tags.where("clientId").equals(clientId).first();
    if (!tag) return null;
    if (!includeDeleted && tag.deletedAt) return null;
    return normalizeStoredTag(tag);
  }

  async getByNameAndCategory(name: string, category: TagCategory): Promise<Tag | null> {
    const normalized = normalizeTagName(name);
    const safeCategory = sanitizeTagCategory(category);
    const tag = await db.tags
      .filter(
        (t) =>
          !t.deletedAt &&
          sanitizeTagCategory(t.category) === safeCategory &&
          normalizeTagName(t.name) === normalized
      )
      .first();
    return tag ? normalizeStoredTag(tag) : null;
  }

  async upsertFromRemote(tag: Tag): Promise<Tag> {
    const existingByRemote =
      tag.remoteId != null ? await this.getByRemoteId(tag.remoteId, true) : null;
    const existingByClient =
      !existingByRemote && tag.clientId
        ? await this.getByClientId(tag.clientId, true)
        : null;
    const existing = existingByRemote ?? existingByClient;

    const payload: Tag = {
      ...tag,
      name: sanitizeTagName(tag.name),
      category: sanitizeTagCategory(tag.category),
      color: sanitizeTagColor(tag.color),
      clientId: tag.clientId ?? existing?.clientId ?? createUuid(),
      deviceId: tag.deviceId ?? null,
      deletedAt: tag.deletedAt ?? null,
      version: tag.version ?? existing?.version ?? 1,
    };

    if (existing?.id != null) {
      await db.tags.update(existing.id, {
        ...payload,
        id: existing.id,
      });
      const updated = await db.tags.get(existing.id);
      if (!updated) {
        throw new Error(`Tag not found after remote upsert: ${existing.id}`);
      }
      return normalizeStoredTag(updated);
    }

    const toInsert: Tag = { ...payload };
    delete (toInsert as { id?: number }).id;
    const id = await db.tags.add(toInsert);
    return normalizeStoredTag({ ...toInsert, id });
  }

  async list(category?: TagCategory): Promise<Tag[]> {
    const safeCategory = category ? sanitizeTagCategory(category) : undefined;
    if (!category) {
      const tags = await db.tags.filter((t) => !t.deletedAt).toArray();
      return tags.map((tag) => normalizeStoredTag(tag));
    }
    const tags = await db.tags
      .filter((t) => sanitizeTagCategory(t.category) === safeCategory && !t.deletedAt)
      .toArray();
    return tags.map((tag) => normalizeStoredTag(tag));
  }

  async create(tag: Tag): Promise<Tag> {
    const name = sanitizeTagName(tag.name);
    const category = sanitizeTagCategory(tag.category);
    const color = sanitizeTagColor(tag.color);
    const normalized = normalizeTagName(name);
    const existing = await db.tags
      .filter(
        (t) => sanitizeTagCategory(t.category) === category && normalizeTagName(t.name) === normalized
      )
      .first();

    if (existing?.id != null) {
      // Treat create as upsert by normalized name/category to prevent duplicates.
      const shouldUpdate =
        Boolean(existing.deletedAt) || existing.name !== name || existing.color !== color;

      if (shouldUpdate) {
        const updatedAt = tag.updatedAt ?? now();
        await db.tags.update(existing.id, {
          name,
          category,
          color,
          deletedAt: null,
          updatedAt,
          deviceId: tag.deviceId ?? getOrCreateDeviceId(),
          clientId: existing.clientId ?? tag.clientId ?? createUuid(),
          version: incrementVersion(existing.version),
        });
        const revived = await db.tags.get(existing.id);
        if (!revived) {
          throw new Error(`Tag not found after revive/update: ${existing.id}`);
        }
        return normalizeStoredTag(revived);
      }

      return normalizeStoredTag(existing);
    }

    const createdAt = tag.createdAt ?? now();
    const updatedAt = tag.updatedAt ?? createdAt;
    const record: Tag = {
      ...tag,
      name,
      category,
      color,
      clientId: tag.clientId ?? createUuid(),
      deviceId: tag.deviceId ?? getOrCreateDeviceId(),
      createdAt,
      updatedAt,
      deletedAt: tag.deletedAt ?? null,
      version: tag.version ?? 1,
    };
    const id = await db.tags.add(record);
    return normalizeStoredTag({ ...record, id });
  }

  async update(id: number, updates: Partial<Tag>): Promise<Tag> {
    const existing = await db.tags.get(id);
    if (!existing) {
      throw new Error(`Tag not found: ${id}`);
    }

    const merged: Partial<Tag> = {
      ...updates,
      clientId: updates.clientId ?? existing.clientId ?? createUuid(),
      deviceId: updates.deviceId ?? getOrCreateDeviceId(),
      updatedAt: updates.updatedAt ?? now(),
      version: updates.version ?? incrementVersion(existing.version),
    };

    // Important: never write undefined into persisted tag fields on partial updates.
    if (updates.name !== undefined) {
      merged.name = sanitizeTagName(updates.name);
    } else {
      delete (merged as { name?: string }).name;
    }
    if (updates.category !== undefined) {
      merged.category = sanitizeTagCategory(updates.category);
    } else {
      delete (merged as { category?: TagCategory }).category;
    }
    if (updates.color !== undefined) {
      merged.color = sanitizeTagColor(updates.color);
    } else {
      delete (merged as { color?: string }).color;
    }

    await db.tags.update(id, merged);
    const updated = await db.tags.get(id);
    if (!updated) {
      throw new Error(`Tag not found: ${id}`);
    }
    return normalizeStoredTag(updated);
  }

  async delete(id: number): Promise<void> {
    const existing = await db.tags.get(id);
    if (!existing || existing.deletedAt) return;

    const deletedAt = now();
    const nextVersion = incrementVersion(existing.version);
    const deviceId = getOrCreateDeviceId();

    await db.transaction("rw", db.tags, db.trade_tags, async () => {
      await db.tags.update(id, {
        deletedAt,
        updatedAt: deletedAt,
        deviceId,
        version: nextVersion,
      });

      const links = await db.trade_tags.where("tagId").equals(id).toArray();
      for (const link of links) {
        if (link.id == null || link.deletedAt) continue;
        await db.trade_tags.update(link.id, {
          deletedAt,
          updatedAt: deletedAt,
          deviceId,
          version: incrementVersion(link.version),
        });
      }
    });
  }

  async deleteByRemoteId(remoteId: number): Promise<void> {
    const tag = await this.getByRemoteId(remoteId, true);
    if (tag?.id != null) {
      await db.tags.delete(tag.id);
      await db.trade_tags.where("tagId").equals(tag.id).delete();
    }
  }

  async deleteByClientId(clientId: string): Promise<void> {
    const tag = await this.getByClientId(clientId, true);
    if (tag?.id != null) {
      await db.tags.delete(tag.id);
      await db.trade_tags.where("tagId").equals(tag.id).delete();
    }
  }

  async listForTrade(tradeId: number): Promise<Tag[]> {
    const tradeTags = await db.trade_tags
      .filter((entry) => entry.tradeId === tradeId && !entry.deletedAt)
      .toArray();
    const tagIds = tradeTags.map((entry) => entry.tagId);
    if (tagIds.length === 0) {
      return [];
    }
    const tags = await db.tags.bulkGet(tagIds);
    return tags
      .filter((tag): tag is Tag => Boolean(tag && !tag.deletedAt))
      .map((tag) => normalizeStoredTag(tag));
  }

  async addToTrade(tradeId: number, tagId: number): Promise<TradeTag> {
    const existing = await db.trade_tags
      .where("[tradeId+tagId]")
      .equals([tradeId, tagId])
      .first();

    const timestamp = now();
    const deviceId = getOrCreateDeviceId();

    if (existing?.id != null) {
      await db.trade_tags.update(existing.id, {
        deletedAt: null,
        updatedAt: timestamp,
        deviceId,
        clientId: existing.clientId ?? createUuid(),
        version: incrementVersion(existing.version),
      });
      const updated = await db.trade_tags.get(existing.id);
      if (!updated) {
        throw new Error(`Trade tag not found: ${existing.id}`);
      }
      return updated;
    }

    const tradeTag: TradeTag = {
      clientId: createUuid(),
      tradeId,
      tagId,
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null,
      deviceId,
      version: 1,
    };
    const id = await db.trade_tags.add(tradeTag);
    return { ...tradeTag, id };
  }

  async removeFromTrade(tradeId: number, tagId: number): Promise<void> {
    const record = await db.trade_tags
      .where("[tradeId+tagId]")
      .equals([tradeId, tagId])
      .first();
    if (!record?.id || record.deletedAt) {
      return;
    }

    const timestamp = now();
    await db.trade_tags.update(record.id, {
      deletedAt: timestamp,
      updatedAt: timestamp,
      deviceId: getOrCreateDeviceId(),
      version: incrementVersion(record.version),
    });
  }

  async replaceForTrade(tradeId: number, tagIds: number[]): Promise<void> {
    const desired = new Set(tagIds);
    const timestamp = now();
    const deviceId = getOrCreateDeviceId();

    await db.transaction("rw", db.trade_tags, async () => {
      const existing = await db.trade_tags.where("tradeId").equals(tradeId).toArray();
      const existingByTag = new Map<number, TradeTag>();
      for (const record of existing) {
        existingByTag.set(record.tagId, record);
      }

      for (const record of existing) {
        if (record.id == null) continue;
        const shouldExist = desired.has(record.tagId);
        if (shouldExist && record.deletedAt) {
          await db.trade_tags.update(record.id, {
            deletedAt: null,
            updatedAt: timestamp,
            deviceId,
            clientId: record.clientId ?? createUuid(),
            version: incrementVersion(record.version),
          });
          continue;
        }
        if (!shouldExist && !record.deletedAt) {
          await db.trade_tags.update(record.id, {
            deletedAt: timestamp,
            updatedAt: timestamp,
            deviceId,
            version: incrementVersion(record.version),
          });
        }
      }

      const toInsert = tagIds.filter((tagId) => !existingByTag.has(tagId));
      if (toInsert.length === 0) return;

      const records: TradeTag[] = toInsert.map((tagId) => ({
        clientId: createUuid(),
        tradeId,
        tagId,
        createdAt: timestamp,
        updatedAt: timestamp,
        deletedAt: null,
        deviceId,
        version: 1,
      }));
      await db.trade_tags.bulkAdd(records);
    });
  }

  async getTradeTagByRemoteId(remoteId: number): Promise<TradeTag | null> {
    const tradeTag = await db.trade_tags.where("remoteId").equals(remoteId).first();
    return tradeTag ?? null;
  }

  async getTradeTagByClientId(clientId: string): Promise<TradeTag | null> {
    const tradeTag = await db.trade_tags.where("clientId").equals(clientId).first();
    return tradeTag ?? null;
  }

  async upsertTradeTagFromRemote(input: {
    remoteId: number;
    clientId?: string;
    tradeId: number;
    tagId: number;
    createdAt: Date;
    updatedAt?: Date;
    deletedAt?: Date | null;
    deviceId?: string | null;
    version?: number;
  }): Promise<TradeTag> {
    const existingByRemote = await this.getTradeTagByRemoteId(input.remoteId);
    const existingByClient =
      !existingByRemote && input.clientId
        ? await this.getTradeTagByClientId(input.clientId)
        : null;
    const existing = existingByRemote ?? existingByClient;

    const payload: TradeTag = {
      remoteId: input.remoteId,
      clientId: input.clientId ?? existing?.clientId ?? createUuid(),
      tradeId: input.tradeId,
      tagId: input.tagId,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt ?? input.createdAt,
      deletedAt: input.deletedAt ?? null,
      deviceId: input.deviceId ?? null,
      version: input.version ?? existing?.version ?? 1,
    };

    if (existing?.id != null) {
      await db.trade_tags.update(existing.id, payload);
      const updated = await db.trade_tags.get(existing.id);
      if (!updated) {
        throw new Error(`Trade tag not found after remote upsert: ${existing.id}`);
      }
      return updated;
    }

    const id = await db.trade_tags.add(payload);
    return { ...payload, id };
  }

  async deleteTradeTagByRemoteId(remoteId: number): Promise<void> {
    const existing = await this.getTradeTagByRemoteId(remoteId);
    if (existing?.id != null) {
      await db.trade_tags.delete(existing.id);
    }
  }

  async deleteTradeTagByClientId(clientId: string): Promise<void> {
    const existing = await this.getTradeTagByClientId(clientId);
    if (existing?.id != null) {
      await db.trade_tags.delete(existing.id);
    }
  }
}
