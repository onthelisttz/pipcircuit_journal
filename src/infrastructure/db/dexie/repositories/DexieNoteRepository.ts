import type { INoteRepository } from "@application/ports/repositories";
import type { TradeNote } from "@domain/entities";
import { createUuid, getOrCreateDeviceId } from "@infrastructure/sync/utils";
import { db } from "../database";

function now(): Date {
  return new Date();
}

function incrementVersion(current?: number): number {
  return (current ?? 1) + 1;
}

export class DexieNoteRepository implements INoteRepository {
  async getById(id: number): Promise<TradeNote | null> {
    const row = await db.trade_notes.get(id);
    if (!row || row.deletedAt) return null;
    return row;
  }

  async getByIdIncludingDeleted(id: number): Promise<TradeNote | null> {
    return (await db.trade_notes.get(id)) ?? null;
  }

  async getByRemoteId(remoteId: number, includeDeleted = false): Promise<TradeNote | null> {
    const note = await db.trade_notes.where("remoteId").equals(remoteId).first();
    if (!note) return null;
    if (!includeDeleted && note.deletedAt) return null;
    return note;
  }

  async getByClientId(clientId: string, includeDeleted = false): Promise<TradeNote | null> {
    const note = await db.trade_notes.where("clientId").equals(clientId).first();
    if (!note) return null;
    if (!includeDeleted && note.deletedAt) return null;
    return note;
  }

  async listByTradeId(tradeId: number): Promise<TradeNote[]> {
    return db.trade_notes.filter((note) => note.tradeId === tradeId && !note.deletedAt).toArray();
  }

  async create(note: TradeNote): Promise<TradeNote> {
    const createdAt = note.createdAt ?? now();
    const updatedAt = note.updatedAt ?? createdAt;
    const record: TradeNote = {
      ...note,
      clientId: note.clientId ?? createUuid(),
      deviceId: note.deviceId ?? getOrCreateDeviceId(),
      createdAt,
      updatedAt,
      deletedAt: note.deletedAt ?? null,
      version: note.version ?? 1,
    };
    const id = await db.trade_notes.add(record);
    return { ...record, id };
  }

  async update(id: number, updates: Partial<TradeNote>): Promise<TradeNote> {
    const existing = await db.trade_notes.get(id);
    if (!existing) {
      throw new Error(`Trade note not found: ${id}`);
    }

    const merged: Partial<TradeNote> = {
      ...updates,
      clientId: updates.clientId ?? existing.clientId ?? createUuid(),
      deviceId: updates.deviceId ?? getOrCreateDeviceId(),
      updatedAt: updates.updatedAt ?? now(),
      version: updates.version ?? incrementVersion(existing.version),
    };

    await db.trade_notes.update(id, merged);
    const updated = await db.trade_notes.get(id);
    if (!updated) {
      throw new Error(`Trade note not found: ${id}`);
    }
    return updated;
  }

  async delete(id: number): Promise<void> {
    const existing = await db.trade_notes.get(id);
    if (!existing || existing.deletedAt) return;

    const deletedAt = now();
    await db.trade_notes.update(id, {
      deletedAt,
      updatedAt: deletedAt,
      deviceId: getOrCreateDeviceId(),
      version: incrementVersion(existing.version),
    });
  }

  async hardDelete(id: number): Promise<void> {
    await db.trade_notes.delete(id);
  }

  async deleteByRemoteId(remoteId: number): Promise<void> {
    const local = await this.getByRemoteId(remoteId, true);
    if (local?.id != null) {
      await db.trade_notes.delete(local.id);
    }
  }

  async deleteByClientId(clientId: string): Promise<void> {
    const local = await this.getByClientId(clientId, true);
    if (local?.id != null) {
      await db.trade_notes.delete(local.id);
    }
  }

  async upsertFromRemote(note: TradeNote): Promise<TradeNote> {
    const existingByRemote =
      note.remoteId != null ? await this.getByRemoteId(note.remoteId, true) : null;
    const existingByClient =
      !existingByRemote && note.clientId
        ? await this.getByClientId(note.clientId, true)
        : null;
    const existing = existingByRemote ?? existingByClient;

    const payload: TradeNote = {
      ...note,
      clientId: note.clientId ?? existing?.clientId ?? createUuid(),
      deviceId: note.deviceId ?? null,
      deletedAt: note.deletedAt ?? null,
      version: note.version ?? existing?.version ?? 1,
    };

    if (existing?.id != null) {
      await db.trade_notes.update(existing.id, {
        ...payload,
        id: existing.id,
      });
      const updated = await db.trade_notes.get(existing.id);
      if (!updated) {
        throw new Error(`Trade note not found after remote upsert: ${existing.id}`);
      }
      return updated;
    }

    const toInsert: TradeNote = { ...payload };
    delete (toInsert as { id?: number }).id;
    const id = await db.trade_notes.add(toInsert);
    return { ...toInsert, id };
  }
}
