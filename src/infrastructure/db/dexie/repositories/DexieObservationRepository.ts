import type { IObservationRepository } from "@application/ports/repositories";
import type { Observation, ObservationCategory } from "@domain/entities";
import { db } from "../database";

export class DexieObservationRepository implements IObservationRepository {
  async getById(id: number): Promise<Observation | null> {
    return (await db.observations.get(id)) ?? null;
  }

  async list(categoryId?: number): Promise<Observation[]> {
    if (categoryId === undefined) {
      return db.observations.toArray();
    }
    return db.observations.where("categoryId").equals(categoryId).toArray();
  }

  async create(observation: Observation): Promise<Observation> {
    const id = await db.observations.add(observation);
    return { ...observation, id };
  }

  async update(id: number, updates: Partial<Observation>): Promise<Observation> {
    await db.observations.update(id, updates);
    const updated = await db.observations.get(id);
    if (!updated) {
      throw new Error(`Observation not found: ${id}`);
    }
    return updated;
  }

  async delete(id: number): Promise<void> {
    await db.observations.delete(id);
  }

  async listCategories(): Promise<ObservationCategory[]> {
    return db.observation_categories.toArray();
  }

  async createCategory(category: ObservationCategory): Promise<ObservationCategory> {
    const id = await db.observation_categories.add(category);
    return { ...category, id };
  }

  async updateCategory(
    id: number,
    updates: Partial<ObservationCategory>
  ): Promise<ObservationCategory> {
    await db.observation_categories.update(id, updates);
    const updated = await db.observation_categories.get(id);
    if (!updated) {
      throw new Error(`Observation category not found: ${id}`);
    }
    return updated;
  }

  async deleteCategory(id: number): Promise<void> {
    await db.observation_categories.delete(id);
  }
}
