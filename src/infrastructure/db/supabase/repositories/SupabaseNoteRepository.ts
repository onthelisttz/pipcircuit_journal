import type { INoteRepository } from "@application/ports/repositories";
import type { TradeNote } from "@domain/entities";
import { getSupabaseClient } from "../client";

interface SupabaseTradeNote {
  id: number;
  user_id: string;
  trade_id: number;
  content: string;
  created_at: string;
  updated_at: string;
  synced_at: string | null;
  version: number | null;
}

function toDomain(row: SupabaseTradeNote): TradeNote {
  return {
    id: row.id,
    tradeId: row.trade_id,
    content: row.content,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    syncedAt: row.synced_at ? new Date(row.synced_at) : null,
    version: row.version ?? undefined,
  };
}

function toSupabase(n: TradeNote, userId: string): Record<string, unknown> {
  return {
    user_id: userId,
    trade_id: n.tradeId,
    content: n.content,
    created_at: n.createdAt instanceof Date ? n.createdAt.toISOString() : new Date(n.createdAt).toISOString(),
    updated_at: n.updatedAt instanceof Date ? n.updatedAt.toISOString() : new Date(n.updatedAt).toISOString(),
    synced_at: n.syncedAt ? (n.syncedAt instanceof Date ? n.syncedAt.toISOString() : new Date(n.syncedAt).toISOString()) : null,
    version: n.version ?? 1,
  };
}

export class SupabaseNoteRepository implements INoteRepository {
  constructor(private readonly userId: string) {}

  async getById(id: number): Promise<TradeNote | null> {
    const { data, error } = await getSupabaseClient()
      .from("trade_notes")
      .select("*")
      .eq("user_id", this.userId)
      .eq("id", id)
      .single();

    if (error || !data) return null;
    return toDomain(data as SupabaseTradeNote);
  }

  async listByTradeId(tradeId: number): Promise<TradeNote[]> {
    const { data, error } = await getSupabaseClient()
      .from("trade_notes")
      .select("*")
      .eq("user_id", this.userId)
      .eq("trade_id", tradeId)
      .order("created_at", { ascending: true });

    if (error) throw new Error(`Failed to fetch notes: ${error.message}`);
    return (data ?? []).map((r) => toDomain(r as SupabaseTradeNote));
  }

  async create(note: TradeNote): Promise<TradeNote> {
    const row = toSupabase(note, this.userId);
    const { data, error } = await getSupabaseClient()
      .from("trade_notes")
      .insert(row)
      .select("id")
      .single();

    if (error) throw new Error(`Failed to create note: ${error.message}`);
    return { ...note, id: (data as { id: number }).id };
  }

  async update(id: number, updates: Partial<TradeNote>): Promise<TradeNote> {
    const supabaseUpdates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (updates.content !== undefined) supabaseUpdates.content = updates.content;
    if (updates.syncedAt !== undefined) supabaseUpdates.synced_at = updates.syncedAt ? new Date(updates.syncedAt).toISOString() : null;

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
    const { error } = await getSupabaseClient()
      .from("trade_notes")
      .delete()
      .eq("user_id", this.userId)
      .eq("id", id);

    if (error) throw new Error(`Failed to delete note: ${error.message}`);
  }

  async listAll(): Promise<TradeNote[]> {
    const { data, error } = await getSupabaseClient()
      .from("trade_notes")
      .select("*")
      .eq("user_id", this.userId)
      .order("created_at", { ascending: true });

    if (error) throw new Error(`Failed to list notes: ${error.message}`);
    return (data ?? []).map((r) => toDomain(r as SupabaseTradeNote));
  }

  async bulkUpsert(notes: TradeNote[]): Promise<void> {
    if (notes.length === 0) return;
    const rows = notes.map((n) => toSupabase(n, this.userId));
    const { error } = await getSupabaseClient()
      .from("trade_notes")
      .insert(rows);
    if (error) throw new Error(`Failed to insert notes: ${error.message}`);
  }
}
