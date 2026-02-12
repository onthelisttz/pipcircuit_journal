import type { INoteRepository } from "@application/ports/repositories";
import type { TradeNote } from "@domain/entities";
import { createUuid, getOrCreateDeviceId } from "@infrastructure/sync/utils";
import { getSupabaseClient } from "../client";

interface SupabaseTradeNote {
  id: number;
  user_id: string;
  client_id: string;
  trade_id: number;
  content: string;
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

function toDomain(row: SupabaseTradeNote): TradeNote {
  return {
    id: row.id,
    remoteId: row.id,
    clientId: row.client_id,
    tradeId: row.trade_id,
    content: row.content,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    deletedAt: row.deleted_at ? new Date(row.deleted_at) : null,
    syncedAt: row.synced_at ? new Date(row.synced_at) : null,
    deviceId: row.device_id,
    version: row.version ?? undefined,
  };
}

function toSupabase(n: TradeNote, userId: string): Record<string, unknown> {
  return {
    user_id: userId,
    client_id: n.clientId ?? createUuid(),
    trade_id: n.tradeId,
    content: n.content,
    created_at: toIso(n.createdAt),
    updated_at: toIso(n.updatedAt),
    deleted_at: n.deletedAt ? toIso(n.deletedAt) : null,
    synced_at: n.syncedAt ? toIso(n.syncedAt) : null,
    device_id: n.deviceId ?? getOrCreateDeviceId(),
    version: n.version ?? 1,
  };
}

export class SupabaseNoteRepository implements INoteRepository {
  constructor(private readonly userId: string) {}

  async getById(id: number, includeDeleted = true): Promise<TradeNote | null> {
    let query = getSupabaseClient()
      .from("trade_notes")
      .select("*")
      .eq("user_id", this.userId)
      .eq("id", id);
    if (!includeDeleted) {
      query = query.is("deleted_at", null);
    }
    const { data, error } = await query.maybeSingle();

    if (error || !data) return null;
    return toDomain(data as SupabaseTradeNote);
  }

  async getByClientId(clientId: string, includeDeleted = true): Promise<TradeNote | null> {
    let query = getSupabaseClient()
      .from("trade_notes")
      .select("*")
      .eq("user_id", this.userId)
      .eq("client_id", clientId);
    if (!includeDeleted) {
      query = query.is("deleted_at", null);
    }
    const { data, error } = await query.maybeSingle();

    if (error || !data) return null;
    return toDomain(data as SupabaseTradeNote);
  }

  async listByTradeId(tradeId: number): Promise<TradeNote[]> {
    const { data, error } = await getSupabaseClient()
      .from("trade_notes")
      .select("*")
      .eq("user_id", this.userId)
      .eq("trade_id", tradeId)
      .is("deleted_at", null)
      .order("created_at", { ascending: true });

    if (error) throw new Error(`Failed to fetch notes: ${error.message}`);
    return (data ?? []).map((r) => toDomain(r as SupabaseTradeNote));
  }

  async listDeltasSince(since?: Date): Promise<TradeNote[]> {
    if (!since) {
      const { data, error } = await getSupabaseClient()
        .from("trade_notes")
        .select("*")
        .eq("user_id", this.userId)
        .order("updated_at", { ascending: true });
      if (error) throw new Error(`Failed to fetch note deltas: ${error.message}`);
      return (data ?? []).map((r) => toDomain(r as SupabaseTradeNote));
    }

    const sinceIso = since.toISOString();
    const [updatedRes, deletedRes] = await Promise.all([
      getSupabaseClient()
        .from("trade_notes")
        .select("*")
        .eq("user_id", this.userId)
        .gt("updated_at", sinceIso),
      getSupabaseClient()
        .from("trade_notes")
        .select("*")
        .eq("user_id", this.userId)
        .not("deleted_at", "is", null)
        .gt("deleted_at", sinceIso),
    ]);

    if (updatedRes.error) throw new Error(`Failed to fetch note updates: ${updatedRes.error.message}`);
    if (deletedRes.error) throw new Error(`Failed to fetch note deletes: ${deletedRes.error.message}`);

    const map = new Map<number, SupabaseTradeNote>();
    for (const row of (updatedRes.data ?? []) as SupabaseTradeNote[]) {
      map.set(row.id, row);
    }
    for (const row of (deletedRes.data ?? []) as SupabaseTradeNote[]) {
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

  async create(note: TradeNote): Promise<TradeNote> {
    const row = toSupabase(note, this.userId);
    const { data, error } = await getSupabaseClient()
      .from("trade_notes")
      .upsert(row, { onConflict: "user_id,client_id", ignoreDuplicates: false })
      .select("*")
      .single();

    if (error) throw new Error(`Failed to create note: ${error.message}`);
    return toDomain(data as SupabaseTradeNote);
  }

  async update(id: number, updates: Partial<TradeNote>): Promise<TradeNote> {
    const current = await this.getById(id);
    if (!current) throw new Error(`Note not found: ${id}`);

    const supabaseUpdates: Record<string, unknown> = {
      updated_at: updates.updatedAt ? toIso(updates.updatedAt) : new Date().toISOString(),
      synced_at: new Date().toISOString(),
      version: updates.version ?? (current.version ?? 1) + 1,
      device_id: updates.deviceId ?? getOrCreateDeviceId(),
    };
    if (updates.content !== undefined) supabaseUpdates.content = updates.content;
    if (updates.syncedAt !== undefined) {
      supabaseUpdates.synced_at = updates.syncedAt ? toIso(updates.syncedAt) : null;
    }
    if (updates.deletedAt !== undefined) {
      supabaseUpdates.deleted_at = updates.deletedAt ? toIso(updates.deletedAt) : null;
    }
    if (updates.clientId !== undefined) {
      supabaseUpdates.client_id = updates.clientId;
    }

    const { error } = await getSupabaseClient()
      .from("trade_notes")
      .update(supabaseUpdates)
      .eq("user_id", this.userId)
      .eq("id", id);

    if (error) throw new Error(`Failed to update note: ${error.message}`);
    const updated = await this.getById(id);
    if (!updated) throw new Error(`Note not found: ${id}`);
    return updated;
  }

  async delete(id: number): Promise<void> {
    const current = await this.getById(id);
    if (!current) return;

    const deletedAt = new Date();
    const { error } = await getSupabaseClient()
      .from("trade_notes")
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

    if (error) throw new Error(`Failed to delete note: ${error.message}`);
  }

  async deleteByClientId(clientId: string): Promise<void> {
    const note = await this.getByClientId(clientId);
    if (!note?.id) return;
    await this.delete(note.id);
  }

  async listAll(includeDeleted = false): Promise<TradeNote[]> {
    let query = getSupabaseClient()
      .from("trade_notes")
      .select("*")
      .eq("user_id", this.userId)
      .order("created_at", { ascending: true });

    if (!includeDeleted) {
      query = query.is("deleted_at", null);
    }

    const { data, error } = await query;

    if (error) throw new Error(`Failed to list notes: ${error.message}`);
    return (data ?? []).map((r) => toDomain(r as SupabaseTradeNote));
  }

  async bulkUpsert(notes: TradeNote[]): Promise<void> {
    if (notes.length === 0) return;
    const rows = notes.map((note) => toSupabase(note, this.userId));
    const { error } = await getSupabaseClient()
      .from("trade_notes")
      .upsert(rows, { onConflict: "user_id,client_id", ignoreDuplicates: false });
    if (error) throw new Error(`Failed to upsert notes: ${error.message}`);
  }

  async findByTradeAndCreatedAt(tradeId: number, createdAt: Date): Promise<TradeNote | null> {
    const { data, error } = await getSupabaseClient()
      .from("trade_notes")
      .select("*")
      .eq("user_id", this.userId)
      .eq("trade_id", tradeId)
      .eq("created_at", createdAt.toISOString())
      .is("deleted_at", null)
      .maybeSingle();

    if (error || !data) return null;
    return toDomain(data as SupabaseTradeNote);
  }
}
