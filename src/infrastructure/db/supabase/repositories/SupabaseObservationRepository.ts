import type { IObservationRepository } from "@application/ports/repositories";
import type {
  Observation,
  ObservationCategory,
  ObservationChartContext,
  ObservationSource,
} from "@domain/entities";
import { createUuid, getOrCreateDeviceId } from "@infrastructure/sync/utils";
import { getSupabaseClient } from "../client";

interface SupabaseObservation {
  id: number;
  user_id: string;
  client_id: string;
  category_id: number | null;
  source: ObservationSource | null;
  chart_context: ObservationChartContext | null;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  synced_at: string | null;
  device_id: string | null;
  version: number | null;
}

interface SupabaseObservationCategory {
  id: number;
  user_id: string;
  client_id: string;
  name: string;
  color: string;
  created_at: string;
  updated_at: string;
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

function toDomainObs(row: SupabaseObservation): Observation {
  return {
    id: row.id,
    remoteId: row.id,
    clientId: row.client_id,
    categoryId: row.category_id ?? undefined,
    source: row.source ?? "manual",
    chartContext: row.chart_context ?? null,
    title: row.title,
    content: row.content,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    deletedAt: row.deleted_at ? new Date(row.deleted_at) : null,
    syncedAt: row.synced_at ? new Date(row.synced_at) : null,
    deviceId: row.device_id,
    version: row.version ?? undefined,
  };
}

function toDomainCat(row: SupabaseObservationCategory): ObservationCategory {
  return {
    id: row.id,
    remoteId: row.id,
    clientId: row.client_id,
    name: row.name,
    color: row.color,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    deletedAt: row.deleted_at ? new Date(row.deleted_at) : null,
    syncedAt: row.synced_at ? new Date(row.synced_at) : null,
    deviceId: row.device_id,
    version: row.version ?? undefined,
  };
}

function toSupabaseObs(o: Observation, userId: string): Record<string, unknown> {
  return {
    user_id: userId,
    client_id: o.clientId ?? createUuid(),
    category_id: o.categoryId ?? null,
    source: o.source ?? "manual",
    chart_context: o.chartContext ?? null,
    title: o.title,
    content: o.content,
    created_at: toIso(o.createdAt),
    updated_at: toIso(o.updatedAt),
    deleted_at: o.deletedAt ? toIso(o.deletedAt) : null,
    synced_at: o.syncedAt ? toIso(o.syncedAt) : null,
    device_id: o.deviceId ?? getOrCreateDeviceId(),
    version: o.version ?? 1,
  };
}

function toSupabaseCat(c: ObservationCategory, userId: string): Record<string, unknown> {
  return {
    user_id: userId,
    client_id: c.clientId ?? createUuid(),
    name: c.name,
    color: c.color,
    created_at: toIso(c.createdAt),
    updated_at: toIso(c.updatedAt),
    deleted_at: c.deletedAt ? toIso(c.deletedAt) : null,
    synced_at: c.syncedAt ? toIso(c.syncedAt) : null,
    device_id: c.deviceId ?? getOrCreateDeviceId(),
    version: c.version ?? 1,
  };
}

export class SupabaseObservationRepository implements IObservationRepository {
  constructor(private readonly userId: string) {}

  async getById(id: number, includeDeleted = true): Promise<Observation | null> {
    let query = getSupabaseClient()
      .from("observations")
      .select("*")
      .eq("user_id", this.userId)
      .eq("id", id);
    if (!includeDeleted) {
      query = query.is("deleted_at", null);
    }
    const { data, error } = await query.maybeSingle();

    if (error || !data) return null;
    return toDomainObs(data as SupabaseObservation);
  }

  async getByClientId(clientId: string, includeDeleted = true): Promise<Observation | null> {
    let query = getSupabaseClient()
      .from("observations")
      .select("*")
      .eq("user_id", this.userId)
      .eq("client_id", clientId);
    if (!includeDeleted) {
      query = query.is("deleted_at", null);
    }
    const { data, error } = await query.maybeSingle();

    if (error || !data) return null;
    return toDomainObs(data as SupabaseObservation);
  }

  async list(categoryId?: number): Promise<Observation[]> {
    let q = getSupabaseClient()
      .from("observations")
      .select("*")
      .eq("user_id", this.userId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });
    if (categoryId !== undefined) {
      q = q.eq("category_id", categoryId);
    }
    const { data, error } = await q;
    if (error) throw new Error(`Failed to fetch observations: ${error.message}`);
    return (data ?? []).map((r) => toDomainObs(r as SupabaseObservation));
  }

  async listDeltasSince(since?: Date): Promise<Observation[]> {
    if (!since) {
      const { data, error } = await getSupabaseClient()
        .from("observations")
        .select("*")
        .eq("user_id", this.userId)
        .order("updated_at", { ascending: true });
      if (error) throw new Error(`Failed to fetch observation deltas: ${error.message}`);
      return (data ?? []).map((row) => toDomainObs(row as SupabaseObservation));
    }

    const sinceIso = since.toISOString();
    const [updatedRes, deletedRes] = await Promise.all([
      getSupabaseClient()
        .from("observations")
        .select("*")
        .eq("user_id", this.userId)
        .gt("updated_at", sinceIso),
      getSupabaseClient()
        .from("observations")
        .select("*")
        .eq("user_id", this.userId)
        .not("deleted_at", "is", null)
        .gt("deleted_at", sinceIso),
    ]);

    if (updatedRes.error) {
      throw new Error(`Failed to fetch observation updates: ${updatedRes.error.message}`);
    }
    if (deletedRes.error) {
      throw new Error(`Failed to fetch observation deletes: ${deletedRes.error.message}`);
    }

    const map = new Map<number, SupabaseObservation>();
    for (const row of (updatedRes.data ?? []) as SupabaseObservation[]) {
      map.set(row.id, row);
    }
    for (const row of (deletedRes.data ?? []) as SupabaseObservation[]) {
      map.set(row.id, row);
    }

    return Array.from(map.values())
      .sort((a, b) => {
        const aTs = new Date(a.deleted_at ?? a.updated_at).getTime();
        const bTs = new Date(b.deleted_at ?? b.updated_at).getTime();
        return aTs - bTs;
      })
      .map(toDomainObs);
  }

  async create(observation: Observation): Promise<Observation> {
    const row = toSupabaseObs(observation, this.userId);
    const { data, error } = await getSupabaseClient()
      .from("observations")
      .upsert(row, { onConflict: "user_id,client_id", ignoreDuplicates: false })
      .select("*")
      .single();

    if (error) throw new Error(`Failed to create observation: ${error.message}`);
    return toDomainObs(data as SupabaseObservation);
  }

  async update(id: number, updates: Partial<Observation>): Promise<Observation> {
    const current = await this.getById(id);
    if (!current) throw new Error(`Observation not found: ${id}`);

    const supabaseUpdates: Record<string, unknown> = {
      updated_at: updates.updatedAt ? toIso(updates.updatedAt) : new Date().toISOString(),
      synced_at: new Date().toISOString(),
      version: updates.version ?? (current.version ?? 1) + 1,
      device_id: updates.deviceId ?? getOrCreateDeviceId(),
    };
    if (updates.categoryId !== undefined) supabaseUpdates.category_id = updates.categoryId ?? null;
    if (updates.source !== undefined) supabaseUpdates.source = updates.source ?? "manual";
    if (updates.chartContext !== undefined) {
      supabaseUpdates.chart_context = updates.chartContext ?? null;
    }
    if (updates.title !== undefined) supabaseUpdates.title = updates.title;
    if (updates.content !== undefined) supabaseUpdates.content = updates.content;
    if (updates.deletedAt !== undefined) {
      supabaseUpdates.deleted_at = updates.deletedAt ? toIso(updates.deletedAt) : null;
    }
    if (updates.clientId !== undefined) {
      supabaseUpdates.client_id = updates.clientId;
    }

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
    const current = await this.getById(id);
    if (!current) return;

    const deletedAt = new Date();
    const { error } = await getSupabaseClient()
      .from("observations")
      .update({
        deleted_at: deletedAt.toISOString(),
        updated_at: deletedAt.toISOString(),
        synced_at: deletedAt.toISOString(),
        version: (current.version ?? 1) + 1,
        device_id: getOrCreateDeviceId(),
      })
      .eq("user_id", this.userId)
      .eq("id", id)
      .is("deleted_at", null);

    if (error) throw new Error(`Failed to delete observation: ${error.message}`);
  }

  async deleteByClientId(clientId: string): Promise<void> {
    const row = await this.getByClientId(clientId);
    if (!row?.id) return;
    await this.delete(row.id);
  }

  async listCategories(): Promise<ObservationCategory[]> {
    const { data, error } = await getSupabaseClient()
      .from("observation_categories")
      .select("*")
      .eq("user_id", this.userId)
      .is("deleted_at", null)
      .order("name", { ascending: true });

    if (error) throw new Error(`Failed to fetch categories: ${error.message}`);
    return (data ?? []).map((row) => toDomainCat(row as SupabaseObservationCategory));
  }

  async listCategoryDeltasSince(since?: Date): Promise<ObservationCategory[]> {
    if (!since) {
      const { data, error } = await getSupabaseClient()
        .from("observation_categories")
        .select("*")
        .eq("user_id", this.userId)
        .order("updated_at", { ascending: true });
      if (error) {
        throw new Error(`Failed to fetch category deltas: ${error.message}`);
      }
      return (data ?? []).map((row) => toDomainCat(row as SupabaseObservationCategory));
    }

    const sinceIso = since.toISOString();
    const [updatedRes, deletedRes] = await Promise.all([
      getSupabaseClient()
        .from("observation_categories")
        .select("*")
        .eq("user_id", this.userId)
        .gt("updated_at", sinceIso),
      getSupabaseClient()
        .from("observation_categories")
        .select("*")
        .eq("user_id", this.userId)
        .not("deleted_at", "is", null)
        .gt("deleted_at", sinceIso),
    ]);

    if (updatedRes.error) {
      throw new Error(`Failed to fetch category updates: ${updatedRes.error.message}`);
    }
    if (deletedRes.error) {
      throw new Error(`Failed to fetch category deletes: ${deletedRes.error.message}`);
    }

    const map = new Map<number, SupabaseObservationCategory>();
    for (const row of (updatedRes.data ?? []) as SupabaseObservationCategory[]) {
      map.set(row.id, row);
    }
    for (const row of (deletedRes.data ?? []) as SupabaseObservationCategory[]) {
      map.set(row.id, row);
    }

    return Array.from(map.values())
      .sort((a, b) => {
        const aTs = new Date(a.deleted_at ?? a.updated_at).getTime();
        const bTs = new Date(b.deleted_at ?? b.updated_at).getTime();
        return aTs - bTs;
      })
      .map(toDomainCat);
  }

  async createCategory(category: ObservationCategory): Promise<ObservationCategory> {
    const row = toSupabaseCat(category, this.userId);
    const { data, error } = await getSupabaseClient()
      .from("observation_categories")
      .upsert(row, { onConflict: "user_id,client_id", ignoreDuplicates: false })
      .select("*")
      .single();

    if (error) throw new Error(`Failed to create category: ${error.message}`);
    return toDomainCat(data as SupabaseObservationCategory);
  }

  async updateCategory(
    id: number,
    updates: Partial<ObservationCategory>
  ): Promise<ObservationCategory> {
    const current = await this.getCategoryById(id);
    if (!current) throw new Error(`Category not found: ${id}`);

    const supabaseUpdates: Record<string, unknown> = {
      updated_at: updates.updatedAt ? toIso(updates.updatedAt) : new Date().toISOString(),
      synced_at: new Date().toISOString(),
      version: updates.version ?? (current.version ?? 1) + 1,
      device_id: updates.deviceId ?? getOrCreateDeviceId(),
    };
    if (updates.name !== undefined) supabaseUpdates.name = updates.name;
    if (updates.color !== undefined) supabaseUpdates.color = updates.color;
    if (updates.deletedAt !== undefined) {
      supabaseUpdates.deleted_at = updates.deletedAt ? toIso(updates.deletedAt) : null;
    }
    if (updates.clientId !== undefined) {
      supabaseUpdates.client_id = updates.clientId;
    }

    const { error } = await getSupabaseClient()
      .from("observation_categories")
      .update(supabaseUpdates)
      .eq("user_id", this.userId)
      .eq("id", id);

    if (error) throw new Error(`Failed to update category: ${error.message}`);
    const updated = await this.getCategoryById(id);
    if (!updated) throw new Error(`Category not found: ${id}`);
    return updated;
  }

  async deleteCategory(id: number): Promise<void> {
    const current = await this.getCategoryById(id);
    if (!current) return;

    const deletedAt = new Date();
    const { error } = await getSupabaseClient()
      .from("observation_categories")
      .update({
        deleted_at: deletedAt.toISOString(),
        updated_at: deletedAt.toISOString(),
        synced_at: deletedAt.toISOString(),
        version: (current.version ?? 1) + 1,
        device_id: getOrCreateDeviceId(),
      })
      .eq("user_id", this.userId)
      .eq("id", id)
      .is("deleted_at", null);

    if (error) throw new Error(`Failed to delete category: ${error.message}`);
  }

  async deleteCategoryByClientId(clientId: string): Promise<void> {
    const category = await this.getCategoryByClientId(clientId);
    if (!category?.id) return;
    await this.deleteCategory(category.id);
  }

  async listAll(includeDeleted = false): Promise<Observation[]> {
    let query = getSupabaseClient()
      .from("observations")
      .select("*")
      .eq("user_id", this.userId)
      .order("created_at", { ascending: false });

    if (!includeDeleted) {
      query = query.is("deleted_at", null);
    }

    const { data, error } = await query;
    if (error) throw new Error(`Failed to list observations: ${error.message}`);
    return (data ?? []).map((row) => toDomainObs(row as SupabaseObservation));
  }

  async listAllCategories(includeDeleted = false): Promise<ObservationCategory[]> {
    let query = getSupabaseClient()
      .from("observation_categories")
      .select("*")
      .eq("user_id", this.userId)
      .order("name", { ascending: true });

    if (!includeDeleted) {
      query = query.is("deleted_at", null);
    }

    const { data, error } = await query;
    if (error) throw new Error(`Failed to list categories: ${error.message}`);
    return (data ?? []).map((row) => toDomainCat(row as SupabaseObservationCategory));
  }

  async bulkUpsertObservations(observations: Observation[]): Promise<void> {
    if (observations.length === 0) return;
    const rows = observations.map((obs) => toSupabaseObs(obs, this.userId));
    const { error } = await getSupabaseClient()
      .from("observations")
      .upsert(rows, { onConflict: "user_id,client_id", ignoreDuplicates: false });
    if (error) throw new Error(`Failed to upsert observations: ${error.message}`);
  }

  async bulkUpsertCategories(categories: ObservationCategory[]): Promise<void> {
    if (categories.length === 0) return;
    const rows = categories.map((category) => toSupabaseCat(category, this.userId));
    const { error } = await getSupabaseClient()
      .from("observation_categories")
      .upsert(rows, { onConflict: "user_id,client_id", ignoreDuplicates: false });
    if (error) throw new Error(`Failed to upsert categories: ${error.message}`);
  }

  async getCategoryById(
    id: number,
    includeDeleted = true
  ): Promise<ObservationCategory | null> {
    let query = getSupabaseClient()
      .from("observation_categories")
      .select("*")
      .eq("user_id", this.userId)
      .eq("id", id);
    if (!includeDeleted) {
      query = query.is("deleted_at", null);
    }
    const { data, error } = await query.maybeSingle();

    if (error || !data) return null;
    return toDomainCat(data as SupabaseObservationCategory);
  }

  async getCategoryByClientId(
    clientId: string,
    includeDeleted = true
  ): Promise<ObservationCategory | null> {
    let query = getSupabaseClient()
      .from("observation_categories")
      .select("*")
      .eq("user_id", this.userId)
      .eq("client_id", clientId);
    if (!includeDeleted) {
      query = query.is("deleted_at", null);
    }
    const { data, error } = await query.maybeSingle();

    if (error || !data) return null;
    return toDomainCat(data as SupabaseObservationCategory);
  }

  async getCategoryByName(name: string): Promise<ObservationCategory | null> {
    const { data, error } = await getSupabaseClient()
      .from("observation_categories")
      .select("*")
      .eq("user_id", this.userId)
      .eq("name", name)
      .is("deleted_at", null)
      .maybeSingle();

    if (error || !data) return null;
    return toDomainCat(data as SupabaseObservationCategory);
  }

  async findByCreatedAtAndTitle(createdAt: Date, title: string): Promise<Observation | null> {
    const { data, error } = await getSupabaseClient()
      .from("observations")
      .select("*")
      .eq("user_id", this.userId)
      .eq("created_at", createdAt.toISOString())
      .eq("title", title)
      .is("deleted_at", null)
      .maybeSingle();

    if (error || !data) return null;
    return toDomainObs(data as SupabaseObservation);
  }
}
