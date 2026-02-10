import type { DailySummary } from "@domain/entities";

export interface IDailySummaryRepository {
  getById?(id: number): Promise<DailySummary | null>;
  getByDate(accountId: string, date: string): Promise<DailySummary | null>;
  listByRange(accountId: string, from: string, to: string): Promise<DailySummary[]>;
  create(summary: DailySummary): Promise<DailySummary>;
  update(id: number, updates: Partial<DailySummary>): Promise<DailySummary>;
  delete(id: number): Promise<void>;
}
