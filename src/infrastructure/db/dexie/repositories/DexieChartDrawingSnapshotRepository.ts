import type { ChartDrawingSnapshotRecord } from "../database";
import { db } from "../database";

export class DexieChartDrawingSnapshotRepository {
  async get(key: string): Promise<ChartDrawingSnapshotRecord | null> {
    return (await db.chart_drawing_snapshots.get(key)) ?? null;
  }

  async set(record: ChartDrawingSnapshotRecord): Promise<void> {
    await db.chart_drawing_snapshots.put(record);
  }

  async remove(key: string): Promise<void> {
    await db.chart_drawing_snapshots.delete(key);
  }
}
