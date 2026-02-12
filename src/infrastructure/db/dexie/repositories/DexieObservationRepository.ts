import type { IObservationRepository } from "@application/ports/repositories";
import type { Observation, ObservationCategory } from "@domain/entities";
import { createUuid, getOrCreateDeviceId } from "@infrastructure/sync/utils";
import { db } from "../database";

function now(): Date {
  return new Date();
}

function incrementVersion(current?: number): number {
  return (current ?? 1) + 1;
}

export class DexieObservationRepository implements IObservationRepository {
  async getById(id: number): Promise<Observation | null> {
    const row = await db.observations.get(id);
    if (!row || row.deletedAt) return null;
    return row;
  }

  async getByIdIncludingDeleted(id: number): Promise<Observation | null> {
    return (await db.observations.get(id)) ?? null;
  }

  async getByRemoteId(remoteId: number, includeDeleted = false): Promise<Observation | null> {
    const observation = await db.observations.where("remoteId").equals(remoteId).first();
    if (!observation) return null;
    if (!includeDeleted && observation.deletedAt) return null;
    return observation;
  }

  async getByClientId(clientId: string, includeDeleted = false): Promise<Observation | null> {
    const observation = await db.observations.where("clientId").equals(clientId).first();
    if (!observation) return null;
    if (!includeDeleted && observation.deletedAt) return null;
    return observation;
  }

  async list(categoryId?: number): Promise<Observation[]> {
    if (categoryId === undefined) {
      return db.observations.filter((obs) => !obs.deletedAt).toArray();
    }
    return db.observations
      .filter((obs) => obs.categoryId === categoryId && !obs.deletedAt)
      .toArray();
  }

  async create(observation: Observation): Promise<Observation> {
    const createdAt = observation.createdAt ?? now();
    const updatedAt = observation.updatedAt ?? createdAt;
    const record: Observation = {
      ...observation,
      clientId: observation.clientId ?? createUuid(),
      deviceId: observation.deviceId ?? getOrCreateDeviceId(),
      createdAt,
      updatedAt,
      deletedAt: observation.deletedAt ?? null,
      version: observation.version ?? 1,
    };
    const id = await db.observations.add(record);
    return { ...record, id };
  }

  async update(id: number, updates: Partial<Observation>): Promise<Observation> {
    const existing = await db.observations.get(id);
    if (!existing) {
      throw new Error(`Observation not found: ${id}`);
    }

    const merged: Partial<Observation> = {
      ...updates,
      clientId: updates.clientId ?? existing.clientId ?? createUuid(),
      deviceId: updates.deviceId ?? getOrCreateDeviceId(),
      updatedAt: updates.updatedAt ?? now(),
      version: updates.version ?? incrementVersion(existing.version),
    };

    await db.observations.update(id, merged);
    const updated = await db.observations.get(id);
    if (!updated) {
      throw new Error(`Observation not found: ${id}`);
    }
    return updated;
  }

  async delete(id: number): Promise<void> {
    const existing = await db.observations.get(id);
    if (!existing || existing.deletedAt) return;

    const deletedAt = now();
    await db.observations.update(id, {
      deletedAt,
      updatedAt: deletedAt,
      deviceId: getOrCreateDeviceId(),
      version: incrementVersion(existing.version),
    });
  }

  async hardDelete(id: number): Promise<void> {
    await db.observations.delete(id);
  }

  async deleteByRemoteId(remoteId: number): Promise<void> {
    const existing = await this.getByRemoteId(remoteId, true);
    if (existing?.id != null) {
      await db.observations.delete(existing.id);
    }
  }

  async deleteByClientId(clientId: string): Promise<void> {
    const existing = await this.getByClientId(clientId, true);
    if (existing?.id != null) {
      await db.observations.delete(existing.id);
    }
  }

  async upsertFromRemote(observation: Observation): Promise<Observation> {
    const existingByRemote =
      observation.remoteId != null
        ? await this.getByRemoteId(observation.remoteId, true)
        : null;
    const existingByClient =
      !existingByRemote && observation.clientId
        ? await this.getByClientId(observation.clientId, true)
        : null;
    const existing = existingByRemote ?? existingByClient;

    const payload: Observation = {
      ...observation,
      clientId: observation.clientId ?? existing?.clientId ?? createUuid(),
      deviceId: observation.deviceId ?? null,
      deletedAt: observation.deletedAt ?? null,
      version: observation.version ?? existing?.version ?? 1,
    };

    if (existing?.id != null) {
      await db.observations.update(existing.id, {
        ...payload,
        id: existing.id,
      });
      const updated = await db.observations.get(existing.id);
      if (!updated) {
        throw new Error(`Observation not found after remote upsert: ${existing.id}`);
      }
      return updated;
    }

    const toInsert: Observation = { ...payload };
    delete (toInsert as { id?: number }).id;
    const id = await db.observations.add(toInsert);
    return { ...toInsert, id };
  }

  async listCategories(): Promise<ObservationCategory[]> {
    return db.observation_categories.filter((category) => !category.deletedAt).toArray();
  }

  async getCategoryByRemoteId(
    remoteId: number,
    includeDeleted = false
  ): Promise<ObservationCategory | null> {
    const category = await db.observation_categories.where("remoteId").equals(remoteId).first();
    if (!category) return null;
    if (!includeDeleted && category.deletedAt) return null;
    return category;
  }

  async getCategoryByClientId(
    clientId: string,
    includeDeleted = false
  ): Promise<ObservationCategory | null> {
    const category = await db.observation_categories.where("clientId").equals(clientId).first();
    if (!category) return null;
    if (!includeDeleted && category.deletedAt) return null;
    return category;
  }

  async getCategoryById(id: number): Promise<ObservationCategory | null> {
    const row = await db.observation_categories.get(id);
    if (!row || row.deletedAt) return null;
    return row;
  }

  async getCategoryByIdIncludingDeleted(id: number): Promise<ObservationCategory | null> {
    return (await db.observation_categories.get(id)) ?? null;
  }

  async getCategoryByName(name: string): Promise<ObservationCategory | null> {
    const category = await db.observation_categories
      .filter((c) => c.name === name && !c.deletedAt)
      .first();
    return category ?? null;
  }

  async createCategory(category: ObservationCategory): Promise<ObservationCategory> {
    const createdAt = category.createdAt ?? now();
    const updatedAt = category.updatedAt ?? createdAt;
    const record: ObservationCategory = {
      ...category,
      clientId: category.clientId ?? createUuid(),
      deviceId: category.deviceId ?? getOrCreateDeviceId(),
      createdAt,
      updatedAt,
      deletedAt: category.deletedAt ?? null,
      version: category.version ?? 1,
    };
    const id = await db.observation_categories.add(record);
    return { ...record, id };
  }

  async updateCategory(
    id: number,
    updates: Partial<ObservationCategory>
  ): Promise<ObservationCategory> {
    const existing = await db.observation_categories.get(id);
    if (!existing) {
      throw new Error(`Observation category not found: ${id}`);
    }

    const merged: Partial<ObservationCategory> = {
      ...updates,
      clientId: updates.clientId ?? existing.clientId ?? createUuid(),
      deviceId: updates.deviceId ?? getOrCreateDeviceId(),
      updatedAt: updates.updatedAt ?? now(),
      version: updates.version ?? incrementVersion(existing.version),
    };

    await db.observation_categories.update(id, merged);
    const updated = await db.observation_categories.get(id);
    if (!updated) {
      throw new Error(`Observation category not found: ${id}`);
    }
    return updated;
  }

  async deleteCategory(id: number): Promise<void> {
    const existing = await db.observation_categories.get(id);
    if (!existing || existing.deletedAt) return;

    const deletedAt = now();
    const deviceId = getOrCreateDeviceId();

    await db.transaction("rw", db.observation_categories, db.observations, async () => {
      await db.observation_categories.update(id, {
        deletedAt,
        updatedAt: deletedAt,
        deviceId,
        version: incrementVersion(existing.version),
      });

      const observations = await db.observations.where("categoryId").equals(id).toArray();
      for (const observation of observations) {
        if (observation.id == null || observation.deletedAt) continue;
        await db.observations.update(observation.id, {
          categoryId: null,
          updatedAt: deletedAt,
          deviceId,
          version: incrementVersion(observation.version),
        });
      }
    });
  }

  async hardDeleteCategory(id: number): Promise<void> {
    await db.observation_categories.delete(id);
  }

  async deleteCategoryByRemoteId(remoteId: number): Promise<void> {
    const existing = await this.getCategoryByRemoteId(remoteId, true);
    if (existing?.id != null) {
      await db.observation_categories.delete(existing.id);
      await db.observations
        .where("categoryId")
        .equals(existing.id)
        .modify({ categoryId: null });
    }
  }

  async deleteCategoryByClientId(clientId: string): Promise<void> {
    const existing = await this.getCategoryByClientId(clientId, true);
    if (existing?.id != null) {
      await db.observation_categories.delete(existing.id);
      await db.observations
        .where("categoryId")
        .equals(existing.id)
        .modify({ categoryId: null });
    }
  }

  async upsertCategoryFromRemote(category: ObservationCategory): Promise<ObservationCategory> {
    const existingByRemote =
      category.remoteId != null
        ? await this.getCategoryByRemoteId(category.remoteId, true)
        : null;
    const existingByClient =
      !existingByRemote && category.clientId
        ? await this.getCategoryByClientId(category.clientId, true)
        : null;
    const existing = existingByRemote ?? existingByClient;

    const payload: ObservationCategory = {
      ...category,
      clientId: category.clientId ?? existing?.clientId ?? createUuid(),
      deviceId: category.deviceId ?? null,
      deletedAt: category.deletedAt ?? null,
      version: category.version ?? existing?.version ?? 1,
    };

    if (existing?.id != null) {
      await db.observation_categories.update(existing.id, {
        ...payload,
        id: existing.id,
      });
      const updated = await db.observation_categories.get(existing.id);
      if (!updated) {
        throw new Error(
          `Observation category not found after remote upsert: ${existing.id}`
        );
      }
      return updated;
    }

    const toInsert: ObservationCategory = { ...payload };
    delete (toInsert as { id?: number }).id;
    const id = await db.observation_categories.add(toInsert);
    return { ...toInsert, id };
  }
}
