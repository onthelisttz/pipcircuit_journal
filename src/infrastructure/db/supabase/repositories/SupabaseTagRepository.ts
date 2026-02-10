import type { ITagRepository } from "@application/ports/repositories";
import type { Tag, TradeTag } from "@domain/entities";
import type { TagCategory } from "@domain/enums";
import { getSupabaseClient } from "../client";

interface SupabaseTag {
  id: number;
  user_id: string;
  name: string;
  category: string;
  color: string;
  created_at: string;
  updated_at: string;
}

function toDomain(row: SupabaseTag): Tag {
  return {
    id: row.id,
    name: row.name,
    category: row.category as TagCategory,
    color: row.color,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function toSupabase(t: Tag, userId: string): Record<string, unknown> {
  return {
    user_id: userId,
    name: t.name,
    category: t.category,
    color: t.color,
    created_at: t.createdAt instanceof Date ? t.createdAt.toISOString() : new Date(t.createdAt).toISOString(),
    updated_at: t.updatedAt instanceof Date ? t.updatedAt.toISOString() : new Date(t.updatedAt).toISOString(),
  };
}

export class SupabaseTagRepository implements ITagRepository {
  constructor(private readonly userId: string) {}

  async getById(id: number): Promise<Tag | null> {
    const { data, error } = await getSupabaseClient()
      .from("tags")
      .select("*")
      .eq("user_id", this.userId)
      .eq("id", id)
      .single();

    if (error || !data) return null;
    return toDomain(data as SupabaseTag);
  }

  async list(category?: TagCategory): Promise<Tag[]> {
    let q = getSupabaseClient()
      .from("tags")
      .select("*")
      .eq("user_id", this.userId)
      .order("name", { ascending: true });
    if (category) {
      q = q.eq("category", category);
    }
    const { data, error } = await q;
    if (error) throw new Error(`Failed to fetch tags: ${error.message}`);
    return (data ?? []).map((r) => toDomain(r as SupabaseTag));
  }

  async create(tag: Tag): Promise<Tag> {
    const row = toSupabase(tag, this.userId);
    const { data, error } = await getSupabaseClient()
      .from("tags")
      .insert(row)
      .select("id")
      .single();

    if (error) throw new Error(`Failed to create tag: ${error.message}`);
    return { ...tag, id: (data as { id: number }).id };
  }

  async update(id: number, updates: Partial<Tag>): Promise<Tag> {
    const supabaseUpdates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (updates.name !== undefined) supabaseUpdates.name = updates.name;
    if (updates.category !== undefined) supabaseUpdates.category = updates.category;
    if (updates.color !== undefined) supabaseUpdates.color = updates.color;

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
    await getSupabaseClient()
      .from("trade_tags")
      .delete()
      .eq("user_id", this.userId)
      .eq("tag_id", id);
    const { error } = await getSupabaseClient()
      .from("tags")
      .delete()
      .eq("user_id", this.userId)
      .eq("id", id);

    if (error) throw new Error(`Failed to delete tag: ${error.message}`);
  }

  async listForTrade(tradeId: number): Promise<Tag[]> {
    const { data: ttData } = await getSupabaseClient()
      .from("trade_tags")
      .select("tag_id")
      .eq("user_id", this.userId)
      .eq("trade_id", tradeId);
    const tagIds = (ttData ?? []).map((r: { tag_id: number }) => r.tag_id);
    if (tagIds.length === 0) return [];
    const { data: tagData, error } = await getSupabaseClient()
      .from("tags")
      .select("*")
      .eq("user_id", this.userId)
      .in("id", tagIds);
    if (error) throw new Error(`Failed to fetch tags: ${error.message}`);
    return (tagData ?? []).map((r) => toDomain(r as SupabaseTag));
  }

  async addToTrade(tradeId: number, tagId: number): Promise<TradeTag> {
    const { data, error } = await getSupabaseClient()
      .from("trade_tags")
      .insert({ user_id: this.userId, trade_id: tradeId, tag_id: tagId })
      .select("id")
      .single();

    if (error) throw new Error(`Failed to add tag to trade: ${error.message}`);
    return {
      id: (data as { id: number }).id,
      tradeId,
      tagId,
      createdAt: new Date(),
    };
  }

  async removeFromTrade(tradeId: number, tagId: number): Promise<void> {
    await getSupabaseClient()
      .from("trade_tags")
      .delete()
      .eq("user_id", this.userId)
      .eq("trade_id", tradeId)
      .eq("tag_id", tagId);
  }

  async replaceForTrade(tradeId: number, tagIds: number[]): Promise<void> {
    await getSupabaseClient()
      .from("trade_tags")
      .delete()
      .eq("user_id", this.userId)
      .eq("trade_id", tradeId);
    if (tagIds.length === 0) return;
    const rows = tagIds.map((tagId) => ({
      user_id: this.userId,
      trade_id: tradeId,
      tag_id: tagId,
    }));
    await getSupabaseClient().from("trade_tags").insert(rows);
  }

  async listAll(): Promise<Tag[]> {
    return this.list();
  }

  async listAllTradeTags(): Promise<{ tradeId: number; tagId: number }[]> {
    const { data, error } = await getSupabaseClient()
      .from("trade_tags")
      .select("trade_id, tag_id")
      .eq("user_id", this.userId);
    if (error) throw new Error(`Failed to list trade tags: ${error.message}`);
    return (data ?? []).map((r: { trade_id: number; tag_id: number }) => ({ tradeId: r.trade_id, tagId: r.tag_id }));
  }

  async bulkUpsertTags(tags: Tag[]): Promise<void> {
    if (tags.length === 0) return;

    // Deduplicate by (name, category) so one upsert batch doesn't try to
    // update the same UNIQUE(user_id,name,category) row twice.
    const byKey = new Map<string, Tag>();
    for (const t of tags) {
      const key = `${t.name}::${t.category}`;
      byKey.set(key, t);
    }

    const rows = Array.from(byKey.values()).map((t) => toSupabase(t, this.userId));
    const { error } = await getSupabaseClient()
      .from("tags")
      .upsert(rows, { onConflict: "user_id,name,category", ignoreDuplicates: false });
    if (error) throw new Error(`Failed to upsert tags: ${error.message}`);
  }

  /** Get tag by name + category for ID resolution (used by Dual repos) */
  async getByNameAndCategory(name: string, category: string): Promise<Tag | null> {
    const { data, error } = await getSupabaseClient()
      .from("tags")
      .select("*")
      .eq("user_id", this.userId)
      .eq("name", name)
      .eq("category", category)
      .maybeSingle();

    if (error) return null;
    return data ? toDomain(data as SupabaseTag) : null;
  }
}
