export interface Observation {
  id?: number;
  categoryId?: number | null;
  title: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
  syncedAt?: Date | null;
  version?: number;
}
