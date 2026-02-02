import type { Observation, ObservationCategory } from "@domain/entities";

export interface IObservationRepository {
  getById(id: number): Promise<Observation | null>;
  list(categoryId?: number): Promise<Observation[]>;
  create(observation: Observation): Promise<Observation>;
  update(id: number, updates: Partial<Observation>): Promise<Observation>;
  delete(id: number): Promise<void>;
  listCategories(): Promise<ObservationCategory[]>;
  createCategory(category: ObservationCategory): Promise<ObservationCategory>;
  updateCategory(
    id: number,
    updates: Partial<ObservationCategory>
  ): Promise<ObservationCategory>;
  deleteCategory(id: number): Promise<void>;
}
