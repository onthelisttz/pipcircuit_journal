import type { IDailySummaryRepository } from "@application/ports/repositories";
import type { DailySummary } from "@domain/entities";
import { db } from "../database";

export class DexieDailySummaryRepository implements IDailySummaryRepository {
  async getByDate(accountId: string, date: string): Promise<DailySummary | null> {
    return (
      (await db.daily_summaries
        .where("[accountId+date]")
        .equals([accountId, date])
        .first()) ?? null
    );
  }

  async listByRange(accountId: string, from: string, to: string): Promise<DailySummary[]> {
    return db.daily_summaries
      .where("[accountId+date]")
      .between([accountId, from], [accountId, to], true, true)
      .toArray();
  }

  async create(summary: DailySummary): Promise<DailySummary> {
    const id = await db.daily_summaries.add(summary);
    return { ...summary, id };
  }

  async update(id: number, updates: Partial<DailySummary>): Promise<DailySummary> {
    await db.daily_summaries.update(id, updates);
    const updated = await db.daily_summaries.get(id);
    if (!updated) {
      throw new Error(`Daily summary not found: ${id}`);
    }
    return updated;
  }

  async delete(id: number): Promise<void> {
    await db.daily_summaries.delete(id);
  }
}
