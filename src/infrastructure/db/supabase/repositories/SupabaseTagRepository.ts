import type { ITagRepository } from "@application/ports/repositories";
import type { Tag, TradeTag } from "@domain/entities";
import type { TagCategory } from "@domain/enums";
import { createUuid, getOrCreateDeviceId } from "@infrastructure/sync/utils";
import { getSupabaseClient } from "../client";

interface SupabaseTag {
  id: number;
  user_id: string;
  client_id: string;
  name: string;
  category: string;
  color: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  synced_at: string | null;
  device_id: string | null;
  version: number | null;
}

interface SupabaseTradeTag {
  id: number;
  user_id: string;
  client_id: string;
  trade_id: number;
  tag_id: number;
  created_at: string;
  updated_at: string | null;
  deleted_at: string | null;
  synced_at: string | null;
  device_id: string | null;
  version: number | null;
}

function toDate(value: Date | string | undefined | null): Date {
  if (value instanceof Date) return value;
  if (!value) return new Date();
  return new Date(value);
}

function toIso(value: Date | string | undefined | null): string {
  return toDate(value).toISOString();
}

function normalizeTagName(name: string): string {
  return name.trim().toLowerCase();
}

function toDomain(row: SupabaseTag): Tag {
  return {
    id: row.id,
    remoteId: row.id,
    clientId: row.client_id,
    name: row.name,
    category: row.category as TagCategory,
    color: row.color,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    deletedAt: row.deleted_at ? new Date(row.deleted_at) : null,
    syncedAt: row.synced_at ? new Date(row.synced_at) : null,
    deviceId: row.device_id,
    version: row.version ?? undefined,
  };
}

function toDomainTradeTag(row: SupabaseTradeTag): TradeTag {
  return {
    id: row.id,
    remoteId: row.id,
    clientId: row.client_id,
    tradeId: row.trade_id,
    tagId: row.tag_id,
    createdAt: new Date(row.created_at),
    updatedAt: row.updated_at ? new Date(row.updated_at) : undefined,
    deletedAt: row.deleted_at ? new Date(row.deleted_at) : null,
    syncedAt: row.synced_at ? new Date(row.synced_at) : null,
    deviceId: row.device_id,
    version: row.version ?? undefined,
  };
}

function toSupabase(t: Tag, userId: string): Record<string, unknown> {
  const nowIso = new Date().toISOString();
  return {
    user_id: userId,
    client_id: t.clientId ?? createUuid(),
    name: t.name.trim(),
    category: t.category,
    color: t.color,
    created_at: toIso(t.createdAt),
    updated_at: toIso(t.updatedAt),
    deleted_at: t.deletedAt ? toIso(t.deletedAt) : null,
    synced_at: t.syncedAt ? toIso(t.syncedAt) : nowIso,
    device_id: t.deviceId ?? getOrCreateDeviceId(),
    version: t.version ?? 1,
  };
}

export class SupabaseTagRepository implements ITagRepository {
  constructor(private readonly userId: string) {}

  private async findAnyByNormalizedNameAndCategory(
    name: string,
    category: string
  ): Promise<SupabaseTag | null> {
    const normalized = normalizeTagName(name);
    const { data, error } = await getSupabaseClient()
      .from("tags")
      .select("*")
      .eq("user_id", this.userId)
      .eq("category", category);

    if (error) {
      throw new Error(`Failed to find tag by normalized name/category: ${error.message}`);
    }

    const rows = ((data ?? []) as SupabaseTag[]).filter(
      (row) => normalizeTagName(row.name) === normalized
    );

    if (rows.length === 0) return null;

    const active = rows.find((row) => row.deleted_at == null);
    if (active) return active;

    rows.sort(
      (a, b) =>
        new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    );
    return rows[0];
  }

  async getById(id: number, includeDeleted = true): Promise<Tag | null> {
    let query = getSupabaseClient()
      .from("tags")
      .select("*")
      .eq("user_id", this.userId)
      .eq("id", id);
    if (!includeDeleted) {
      query = query.is("deleted_at", null);
    }
    const { data, error } = await query.maybeSingle();
    if (error || !data) return null;
    return toDomain(data as SupabaseTag);
  }

  async getByClientId(clientId: string, includeDeleted = true): Promise<Tag | null> {
    let query = getSupabaseClient()
      .from("tags")
      .select("*")
      .eq("user_id", this.userId)
      .eq("client_id", clientId);
    if (!includeDeleted) {
      query = query.is("deleted_at", null);
    }
    const { data, error } = await query.maybeSingle();
    if (error || !data) return null;
    return toDomain(data as SupabaseTag);
  }

  async list(category?: TagCategory): Promise<Tag[]> {
    let q = getSupabaseClient()
      .from("tags")
      .select("*")
      .eq("user_id", this.userId)
      .is("deleted_at", null)
      .order("name", { ascending: true });
    if (category) {
      q = q.eq("category", category);
    }
    const { data, error } = await q;
    if (error) throw new Error(`Failed to fetch tags: ${error.message}`);
    return (data ?? []).map((r) => toDomain(r as SupabaseTag));
  }

  async listDeltasSince(since?: Date): Promise<Tag[]> {
    if (!since) {
      const { data, error } = await getSupabaseClient()
        .from("tags")
        .select("*")
        .eq("user_id", this.userId)
        .order("updated_at", { ascending: true });
      if (error) throw new Error(`Failed to fetch tag deltas: ${error.message}`);
      return (data ?? []).map((r) => toDomain(r as SupabaseTag));
    }

    const sinceIso = since.toISOString();
    const [updatedRes, deletedRes] = await Promise.all([
      getSupabaseClient()
        .from("tags")
        .select("*")
        .eq("user_id", this.userId)
        .gt("updated_at", sinceIso),
      getSupabaseClient()
        .from("tags")
        .select("*")
        .eq("user_id", this.userId)
        .not("deleted_at", "is", null)
        .gt("deleted_at", sinceIso),
    ]);

    if (updatedRes.error) throw new Error(`Failed to fetch tag updates: ${updatedRes.error.message}`);
    if (deletedRes.error) throw new Error(`Failed to fetch tag deletes: ${deletedRes.error.message}`);

    const map = new Map<number, SupabaseTag>();
    for (const row of (updatedRes.data ?? []) as SupabaseTag[]) {
      map.set(row.id, row);
    }
    for (const row of (deletedRes.data ?? []) as SupabaseTag[]) {
      map.set(row.id, row);
    }

    return Array.from(map.values())
      .sort((a, b) => {
        const aTs = new Date(a.deleted_at ?? a.updated_at).getTime();
        const bTs = new Date(b.deleted_at ?? b.updated_at).getTime();
        return aTs - bTs;
      })
      .map(toDomain);
  }

  async create(tag: Tag): Promise<Tag> {
    const cleanName = tag.name.trim();
    const existing = await this.findAnyByNormalizedNameAndCategory(cleanName, tag.category);

    if (existing?.id != null) {
      const updatedAt = tag.updatedAt ? toIso(tag.updatedAt) : new Date().toISOString();
      const { data, error } = await getSupabaseClient()
        .from("tags")
        .update({
          name: cleanName,
          category: tag.category,
          color: tag.color,
          deleted_at: null,
          updated_at: updatedAt,
          synced_at: new Date().toISOString(),
          device_id: tag.deviceId ?? getOrCreateDeviceId(),
          version: (existing.version ?? 1) + 1,
          client_id: existing.client_id ?? tag.clientId ?? createUuid(),
        })
        .eq("user_id", this.userId)
        .eq("id", existing.id)
        .select("*")
        .single();

      if (error) throw new Error(`Failed to revive existing tag: ${error.message}`);
      return toDomain(data as SupabaseTag);
    }

    const row = toSupabase({ ...tag, name: cleanName }, this.userId);
    const { data, error } = await getSupabaseClient()
      .from("tags")
      .upsert(row, { onConflict: "user_id,client_id", ignoreDuplicates: false })
      .select("*")
      .single();

    if (error) throw new Error(`Failed to create tag: ${error.message}`);
    return toDomain(data as SupabaseTag);
  }

  async update(id: number, updates: Partial<Tag>): Promise<Tag> {
    const current = await this.getById(id);
    if (!current) throw new Error(`Tag not found: ${id}`);

    const supabaseUpdates: Record<string, unknown> = {
      updated_at: updates.updatedAt ? toIso(updates.updatedAt) : new Date().toISOString(),
      synced_at: new Date().toISOString(),
      device_id: updates.deviceId ?? getOrCreateDeviceId(),
      version: updates.version ?? (current.version ?? 1) + 1,
    };
    if (updates.name !== undefined) supabaseUpdates.name = updates.name.trim();
    if (updates.category !== undefined) supabaseUpdates.category = updates.category;
    if (updates.color !== undefined) supabaseUpdates.color = updates.color;
    if (updates.clientId !== undefined) supabaseUpdates.client_id = updates.clientId;
    if (updates.deletedAt !== undefined) {
      supabaseUpdates.deleted_at = updates.deletedAt ? toIso(updates.deletedAt) : null;
    }

    const { error } = await getSupabaseClient()
      .from("tags")
      .update(supabaseUpdates)
      .eq("user_id", this.userId)
      .eq("id", id);

    if (error) throw new Error(`Failed to update tag: ${error.message}`);
    const updated = await this.getById(id);
    if (!updated) throw new Error(`Tag not found: ${id}`);
    return updated;
  }

  async delete(id: number): Promise<void> {
    const current = await this.getById(id);
    if (!current) return;

    const deletedAt = new Date();
    const nextVersion = (current.version ?? 1) + 1;
    const deviceId = getOrCreateDeviceId();

    await getSupabaseClient()
      .from("trade_tags")
      .update({
        deleted_at: deletedAt.toISOString(),
        updated_at: deletedAt.toISOString(),
        synced_at: deletedAt.toISOString(),
        version: nextVersion,
        device_id: deviceId,
      })
      .eq("user_id", this.userId)
      .eq("tag_id", id)
      .is("deleted_at", null);

    const { error } = await getSupabaseClient()
      .from("tags")
      .update({
        deleted_at: deletedAt.toISOString(),
        updated_at: deletedAt.toISOString(),
        synced_at: deletedAt.toISOString(),
        version: nextVersion,
        device_id: deviceId,
      })
      .eq("user_id", this.userId)
      .eq("id", id)
      .is("deleted_at", null);

    if (error) throw new Error(`Failed to delete tag: ${error.message}`);
  }

  async deleteByClientId(clientId: string): Promise<void> {
    const tag = await this.getByClientId(clientId);
    if (!tag?.id) return;
    await this.delete(tag.id);
  }

  async listForTrade(tradeId: number): Promise<Tag[]> {
    const { data: ttData, error: ttError } = await getSupabaseClient()
      .from("trade_tags")
      .select("tag_id")
      .eq("user_id", this.userId)
      .eq("trade_id", tradeId)
      .is("deleted_at", null);
    if (ttError) throw new Error(`Failed to fetch trade tags: ${ttError.message}`);

    const tagIds = (ttData ?? []).map((r: { tag_id: number }) => r.tag_id);
    if (tagIds.length === 0) return [];

    const { data: tagData, error } = await getSupabaseClient()
      .from("tags")
      .select("*")
      .eq("user_id", this.userId)
      .is("deleted_at", null)
      .in("id", tagIds);
    if (error) throw new Error(`Failed to fetch tags: ${error.message}`);
    return (tagData ?? []).map((r) => toDomain(r as SupabaseTag));
  }

  async addToTrade(tradeId: number, tagId: number): Promise<TradeTag> {
    const timestamp = new Date();
    const existing = await this.getTradeTagByTradeAndTag(tradeId, tagId, true);

    if (existing?.id != null) {
      const { data, error } = await getSupabaseClient()
        .from("trade_tags")
        .update({
          deleted_at: null,
          updated_at: timestamp.toISOString(),
          synced_at: timestamp.toISOString(),
          version: (existing.version ?? 1) + 1,
          device_id: getOrCreateDeviceId(),
          client_id: existing.clientId ?? createUuid(),
        })
        .eq("user_id", this.userId)
        .eq("id", existing.id)
        .select("*")
        .single();
      if (error) throw new Error(`Failed to add tag to trade: ${error.message}`);
      return toDomainTradeTag(data as SupabaseTradeTag);
    }

    const { data, error } = await getSupabaseClient()
      .from("trade_tags")
      .insert({
        user_id: this.userId,
        client_id: createUuid(),
        trade_id: tradeId,
        tag_id: tagId,
        created_at: timestamp.toISOString(),
        updated_at: timestamp.toISOString(),
        synced_at: timestamp.toISOString(),
        deleted_at: null,
        device_id: getOrCreateDeviceId(),
        version: 1,
      })
      .select("*")
      .single();

    if (error) throw new Error(`Failed to add tag to trade: ${error.message}`);
    return toDomainTradeTag(data as SupabaseTradeTag);
  }

  async removeFromTrade(tradeId: number, tagId: number): Promise<void> {
    const existing = await this.getTradeTagByTradeAndTag(tradeId, tagId, false);
    if (!existing?.id) return;

    const timestamp = new Date();
    await getSupabaseClient()
      .from("trade_tags")
      .update({
        deleted_at: timestamp.toISOString(),
        updated_at: timestamp.toISOString(),
        synced_at: timestamp.toISOString(),
        version: (existing.version ?? 1) + 1,
        device_id: getOrCreateDeviceId(),
      })
      .eq("user_id", this.userId)
      .eq("id", existing.id)
      .is("deleted_at", null);
  }

  async replaceForTrade(tradeId: number, tagIds: number[]): Promise<void> {
    const timestamp = new Date();
    const desired = new Set(tagIds);
    const existing = await this.listTradeTagsForTrade(tradeId, true);
    const existingByTagId = new Map<number, TradeTag>();
    for (const row of existing) {
      existingByTagId.set(row.tagId, row);
    }

    const upserts: Record<string, unknown>[] = [];
    const updates: Array<{ id: number; data: Record<string, unknown> }> = [];

    for (const row of existing) {
      if (!row.id) continue;
      const shouldExist = desired.has(row.tagId);
      if (shouldExist && row.deletedAt) {
        updates.push({
          id: row.id,
          data: {
            deleted_at: null,
            updated_at: timestamp.toISOString(),
            synced_at: timestamp.toISOString(),
            version: (row.version ?? 1) + 1,
            device_id: getOrCreateDeviceId(),
            client_id: row.clientId ?? createUuid(),
          },
        });
      } else if (!shouldExist && !row.deletedAt) {
        updates.push({
          id: row.id,
          data: {
            deleted_at: timestamp.toISOString(),
            updated_at: timestamp.toISOString(),
            synced_at: timestamp.toISOString(),
            version: (row.version ?? 1) + 1,
            device_id: getOrCreateDeviceId(),
          },
        });
      }
    }

    for (const tagId of tagIds) {
      if (!existingByTagId.has(tagId)) {
        upserts.push({
          user_id: this.userId,
          client_id: createUuid(),
          trade_id: tradeId,
          tag_id: tagId,
          created_at: timestamp.toISOString(),
          updated_at: timestamp.toISOString(),
          synced_at: timestamp.toISOString(),
          deleted_at: null,
          device_id: getOrCreateDeviceId(),
          version: 1,
        });
      }
    }

    for (const update of updates) {
      const { error } = await getSupabaseClient()
        .from("trade_tags")
        .update(update.data)
        .eq("user_id", this.userId)
        .eq("id", update.id);
      if (error) {
        throw new Error(`Failed to update trade tag: ${error.message}`);
      }
    }

    if (upserts.length > 0) {
      const { error } = await getSupabaseClient().from("trade_tags").insert(upserts);
      if (error) throw new Error(`Failed to insert trade tags: ${error.message}`);
    }
  }

  async listAll(includeDeleted = false): Promise<Tag[]> {
    let query = getSupabaseClient()
      .from("tags")
      .select("*")
      .eq("user_id", this.userId)
      .order("name", { ascending: true });

    if (!includeDeleted) {
      query = query.is("deleted_at", null);
    }

    const { data, error } = await query;
    if (error) throw new Error(`Failed to list tags: ${error.message}`);
    return (data ?? []).map((row) => toDomain(row as SupabaseTag));
  }

  async listAllTradeTags(includeDeleted = false): Promise<
    {
      id: number;
      clientId?: string;
      tradeId: number;
      tagId: number;
      createdAt?: Date;
      updatedAt?: Date;
      deletedAt?: Date | null;
      version?: number;
      deviceId?: string | null;
    }[]
  > {
    let query = getSupabaseClient()
      .from("trade_tags")
      .select("*")
      .eq("user_id", this.userId);
    if (!includeDeleted) {
      query = query.is("deleted_at", null);
    }
    const { data, error } = await query;
    if (error) throw new Error(`Failed to list trade tags: ${error.message}`);
    return (data ?? []).map((row) => {
      const tt = toDomainTradeTag(row as SupabaseTradeTag);
      return {
        id: tt.id ?? 0,
        clientId: tt.clientId,
        tradeId: tt.tradeId,
        tagId: tt.tagId,
        createdAt: tt.createdAt,
        updatedAt: tt.updatedAt,
        deletedAt: tt.deletedAt,
        version: tt.version,
        deviceId: tt.deviceId,
      };
    });
  }

  async listTradeTagDeltasSince(since?: Date): Promise<TradeTag[]> {
    if (!since) {
      const { data, error } = await getSupabaseClient()
        .from("trade_tags")
        .select("*")
        .eq("user_id", this.userId)
        .order("updated_at", { ascending: true });
      if (error) throw new Error(`Failed to fetch trade-tag deltas: ${error.message}`);
      return (data ?? []).map((row) => toDomainTradeTag(row as SupabaseTradeTag));
    }

    const sinceIso = since.toISOString();
    const [updatedRes, deletedRes] = await Promise.all([
      getSupabaseClient()
        .from("trade_tags")
        .select("*")
        .eq("user_id", this.userId)
        .gt("updated_at", sinceIso),
      getSupabaseClient()
        .from("trade_tags")
        .select("*")
        .eq("user_id", this.userId)
        .not("deleted_at", "is", null)
        .gt("deleted_at", sinceIso),
    ]);

    if (updatedRes.error) {
      throw new Error(`Failed to fetch trade-tag updates: ${updatedRes.error.message}`);
    }
    if (deletedRes.error) {
      throw new Error(`Failed to fetch trade-tag deletes: ${deletedRes.error.message}`);
    }

    const map = new Map<number, SupabaseTradeTag>();
    for (const row of (updatedRes.data ?? []) as SupabaseTradeTag[]) {
      map.set(row.id, row);
    }
    for (const row of (deletedRes.data ?? []) as SupabaseTradeTag[]) {
      map.set(row.id, row);
    }

    return Array.from(map.values())
      .sort((a, b) => {
        const aTs = new Date(a.deleted_at ?? a.updated_at ?? a.created_at).getTime();
        const bTs = new Date(b.deleted_at ?? b.updated_at ?? b.created_at).getTime();
        return aTs - bTs;
      })
      .map(toDomainTradeTag);
  }

  async bulkUpsertTags(tags: Tag[]): Promise<void> {
    if (tags.length === 0) return;
    const byKey = new Map<string, Tag>();
    for (const tag of tags) {
      const key = tag.clientId ?? `${normalizeTagName(tag.name)}::${tag.category}`;
      byKey.set(key, { ...tag, name: tag.name.trim() });
    }

    const rows = Array.from(byKey.values()).map((tag) => toSupabase(tag, this.userId));
    const { error } = await getSupabaseClient()
      .from("tags")
      .upsert(rows, { onConflict: "user_id,client_id", ignoreDuplicates: false });
    if (error) throw new Error(`Failed to upsert tags: ${error.message}`);
  }

  async getByNameAndCategory(name: string, category: string): Promise<Tag | null> {
    const row = await this.findAnyByNormalizedNameAndCategory(name, category);
    if (!row || row.deleted_at) return null;
    return toDomain(row);
  }

  private async getTradeTagByTradeAndTag(
    tradeId: number,
    tagId: number,
    includeDeleted: boolean
  ): Promise<TradeTag | null> {
    let query = getSupabaseClient()
      .from("trade_tags")
      .select("*")
      .eq("user_id", this.userId)
      .eq("trade_id", tradeId)
      .eq("tag_id", tagId);
    if (!includeDeleted) {
      query = query.is("deleted_at", null);
    }
    const { data, error } = await query.maybeSingle();
    if (error || !data) return null;
    return toDomainTradeTag(data as SupabaseTradeTag);
  }

  private async listTradeTagsForTrade(
    tradeId: number,
    includeDeleted: boolean
  ): Promise<TradeTag[]> {
    let query = getSupabaseClient()
      .from("trade_tags")
      .select("*")
      .eq("user_id", this.userId)
      .eq("trade_id", tradeId);
    if (!includeDeleted) {
      query = query.is("deleted_at", null);
    }
    const { data, error } = await query;
    if (error) throw new Error(`Failed to load trade tags: ${error.message}`);
    return (data ?? []).map((row) => toDomainTradeTag(row as SupabaseTradeTag));
  }
}
