import type { IObservationRepository } from "@application/ports/repositories";
import type { Observation, ObservationCategory } from "@domain/entities";
import { getSupabaseClient } from "../client";

interface SupabaseObservation {
  id: number;
  user_id: string;
  category_id: number | null;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
  synced_at: string | null;
  version: number | null;
}

interface SupabaseObservationCategory {
  id: number;
  user_id: string;
  name: string;
  color: string;
  created_at: string;
  updated_at: string;
}

function toDomainObs(row: SupabaseObservation): Observation {
  return {
    id: row.id,
    categoryId: row.category_id ?? undefined,
    title: row.title,
    content: row.content,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    syncedAt: row.synced_at ? new Date(row.synced_at) : null,
    version: row.version ?? undefined,
  };
}

function toDomainCat(row: SupabaseObservationCategory): ObservationCategory {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function toSupabaseObs(o: Observation, userId: string): Record<string, unknown> {
  return {
    user_id: userId,
    category_id: o.categoryId ?? null,
    title: o.title,
    content: o.content,
    created_at: o.createdAt instanceof Date ? o.createdAt.toISOString() : new Date(o.createdAt).toISOString(),
    updated_at: o.updatedAt instanceof Date ? o.updatedAt.toISOString() : new Date(o.updatedAt).toISOString(),
    synced_at: o.syncedAt ? (o.syncedAt instanceof Date ? o.syncedAt.toISOString() : new Date(o.syncedAt).toISOString()) : null,
    version: o.version ?? 1,
  };
}

function toSupabaseCat(c: ObservationCategory, userId: string): Record<string, unknown> {
  return {
    user_id: userId,
    name: c.name,
    color: c.color,
    created_at: c.createdAt instanceof Date ? c.createdAt.toISOString() : new Date(c.createdAt).toISOString(),
    updated_at: c.updatedAt instanceof Date ? c.updatedAt.toISOString() : new Date(c.updatedAt).toISOString(),
  };
}

export class SupabaseObservationRepository implements IObservationRepository {
  constructor(private readonly userId: string) {}

  async getById(id: number): Promise<Observation | null> {
    const { data, error } = await getSupabaseClient()
      .from("observations")
      .select("*")
      .eq("user_id", this.userId)
      .eq("id", id)
      .single();

    if (error || !data) return null;
    return toDomainObs(data as SupabaseObservation);
  }

  async list(categoryId?: number): Promise<Observation[]> {
    let q = getSupabaseClient()
      .from("observations")
      .select("*")
      .eq("user_id", this.userId)
      .order("created_at", { ascending: false });
    if (categoryId !== undefined) {
      q = q.eq("category_id", categoryId);
    }
    const { data, error } = await q;
    if (error) throw new Error(`Failed to fetch observations: ${error.message}`);
    return (data ?? []).map((r) => toDomainObs(r as SupabaseObservation));
  }

  async create(observation: Observation): Promise<Observation> {
    const row = toSupabaseObs(observation, this.userId);
    const { data, error } = await getSupabaseClient()
      .from("observations")
      .insert(row)
      .select("id")
      .single();

    if (error) throw new Error(`Failed to create observation: ${error.message}`);
    return { ...observation, id: (data as { id: number }).id };
  }

  async update(id: number, updates: Partial<Observation>): Promise<Observation> {
    const supabaseUpdates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (updates.categoryId !== undefined) supabaseUpdates.category_id = updates.categoryId;
    if (updates.title !== undefined) supabaseUpdates.title = updates.title;
    if (updates.content !== undefined) supabaseUpdates.content = updates.content;

    const { error } = await getSupabaseClient()
      .from("observations")
      .update(supabaseUpdates)
      .eq("user_id", this.userId)
      .eq("id", id);

    if (error) throw new Error(`Failed to update observation: ${error.message}`);
    const updated = await this.getById(id);
    if (!updated) throw new Error(`Observation not found: ${id}`);
    return updated;
  }

  async delete(id: number): Promise<void> {
    const { error } = await getSupabaseClient()
      .from("observations")
      .delete()
      .eq("user_id", this.userId)
      .eq("id", id);

    if (error) throw new Error(`Failed to delete observation: ${error.message}`);
  }

  async listCategories(): Promise<ObservationCategory[]> {
    const { data, error } = await getSupabaseClient()
      .from("observation_categories")
      .select("*")
      .eq("user_id", this.userId)
      .order("name", { ascending: true });

    if (error) throw new Error(`Failed to fetch categories: ${error.message}`);
    return (data ?? []).map((r) => toDomainCat(r as SupabaseObservationCategory));
  }

  async createCategory(category: ObservationCategory): Promise<ObservationCategory> {
    const row = toSupabaseCat(category, this.userId);
    const { data, error } = await getSupabaseClient()
      .from("observation_categories")
      .insert(row)
      .select("id")
      .single();

    if (error) throw new Error(`Failed to create category: ${error.message}`);
    return { ...category, id: (data as { id: number }).id };
  }

  async updateCategory(id: number, updates: Partial<ObservationCategory>): Promise<ObservationCategory> {
    const supabaseUpdates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (updates.name !== undefined) supabaseUpdates.name = updates.name;
    if (updates.color !== undefined) supabaseUpdates.color = updates.color;

    const { error } = await getSupabaseClient()
      .from("observation_categories")
      .update(supabaseUpdates)
      .eq("user_id", this.userId)
      .eq("id", id);

    if (error) throw new Error(`Failed to update category: ${error.message}`);
    const updated = await getSupabaseClient()
      .from("observation_categories")
      .select("*")
      .eq("user_id", this.userId)
      .eq("id", id)
      .single();
    if (updated.error || !updated.data) throw new Error(`Category not found: ${id}`);
    return toDomainCat(updated.data as SupabaseObservationCategory);
  }

  async deleteCategory(id: number): Promise<void> {
    const { error } = await getSupabaseClient()
      .from("observation_categories")
      .delete()
      .eq("user_id", this.userId)
      .eq("id", id);

    if (error) throw new Error(`Failed to delete category: ${error.message}`);
  }

  async listAll(): Promise<Observation[]> {
    return this.list();
  }

  async listAllCategories(): Promise<ObservationCategory[]> {
    return this.listCategories();
  }

  async bulkUpsertObservations(observations: Observation[]): Promise<void> {
    if (observations.length === 0) return;
    const supabase = getSupabaseClient();

    // Load existing observations once so we can avoid inserting exact duplicates
    // (re-running full sync will not create another copy of the same observation).
    const existing = await this.listAll();
    const existingKeys = new Set(
      existing.map(
        (o) => `${o.title}::${o.content}::${o.createdAt.toISOString()}`
      )
    );

    const toInsert = observations.filter((o) => {
      // Only skip if all three match (title, content, createdAt)
      const key = `${o.title}::${o.content}::${o.createdAt.toISOString()}`;
      if (existingKeys.has(key)) {
        return false;
      }
      // Remember this key so we don't insert the same thing twice within this batch
      existingKeys.add(key);
      return true;
    });

    if (toInsert.length === 0) return;

    const rows = toInsert.map((o) => toSupabaseObs(o, this.userId));
    const { error } = await supabase.from("observations").insert(rows);
    if (error) throw new Error(`Failed to insert observations: ${error.message}`);
  }

  async bulkUpsertCategories(categories: ObservationCategory[]): Promise<void> {
    if (categories.length === 0) return;
    // Deduplicate by name so one upsert batch doesn't touch the same row twice (avoids "cannot affect row a second time")
    const byName = new Map<string, ObservationCategory>();
    for (const c of categories) {
      byName.set(c.name, c);
    }
    const rows = Array.from(byName.values()).map((c) => toSupabaseCat(c, this.userId));
    const { error } = await getSupabaseClient()
      .from("observation_categories")
      .upsert(rows, { onConflict: "user_id,name", ignoreDuplicates: false });
    if (error) throw new Error(`Failed to upsert categories: ${error.message}`);
  }

  /** Get category by name for ID resolution (used by Dual repos) */
  async getCategoryByName(name: string): Promise<ObservationCategory | null> {
    const { data, error } = await getSupabaseClient()
      .from("observation_categories")
      .select("*")
      .eq("user_id", this.userId)
      .eq("name", name)
      .maybeSingle();

    if (error) return null;
    return data ? toDomainCat(data as SupabaseObservationCategory) : null;
  }
}
