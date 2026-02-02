import type { INoteRepository } from "@application/ports/repositories";
import type { TradeNote } from "@domain/entities";
import { db } from "../database";

export class DexieNoteRepository implements INoteRepository {
  async getById(id: number): Promise<TradeNote | null> {
    return (await db.trade_notes.get(id)) ?? null;
  }

  async listByTradeId(tradeId: number): Promise<TradeNote[]> {
    return db.trade_notes.where("tradeId").equals(tradeId).toArray();
  }

  async create(note: TradeNote): Promise<TradeNote> {
    const id = await db.trade_notes.add(note);
    return { ...note, id };
  }

  async update(id: number, updates: Partial<TradeNote>): Promise<TradeNote> {
    await db.trade_notes.update(id, updates);
    const updated = await db.trade_notes.get(id);
    if (!updated) {
      throw new Error(`Trade note not found: ${id}`);
    }
    return updated;
  }

  async delete(id: number): Promise<void> {
    await db.trade_notes.delete(id);
  }
}
