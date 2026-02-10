import type { IObservationRepository } from "@application/ports/repositories";
import type { Observation, ObservationCategory } from "@domain/entities";
import { isOnline } from "@infrastructure/sync/utils/connection";

type CategoryResolver = (dexieCategoryId: number) => Promise<number | null>;

type ObservationBulkUpsertRepo = IObservationRepository & {
  bulkUpsertObservations: (observations: Observation[]) => Promise<void>;
};

type ObservationCategoryBulkUpsertRepo = IObservationRepository & {
  bulkUpsertCategories: (categories: ObservationCategory[]) => Promise<void>;
};

type ObservationCategoryLookupRepo = IObservationRepository & {
  getCategoryByName: (name: string) => Promise<ObservationCategory | null>;
};

const hasBulkUpsertObservations = (
  repo: IObservationRepository | null
): repo is ObservationBulkUpsertRepo =>
  Boolean(
    repo &&
      typeof (repo as ObservationBulkUpsertRepo).bulkUpsertObservations === "function"
  );

const hasBulkUpsertCategories = (
  repo: IObservationRepository | null
): repo is ObservationCategoryBulkUpsertRepo =>
  Boolean(
    repo &&
      typeof (repo as ObservationCategoryBulkUpsertRepo).bulkUpsertCategories === "function"
  );

const hasGetCategoryByName = (
  repo: IObservationRepository | null
): repo is ObservationCategoryLookupRepo =>
  Boolean(
    repo && typeof (repo as ObservationCategoryLookupRepo).getCategoryByName === "function"
  );

/**
 * Dual repository: reads from Dexie, writes to Dexie + Supabase (when online).
 * Real-time sync for observations and categories. Resolves category ID for observations.
 */
export class DualObservationRepository implements IObservationRepository {
  constructor(
    private readonly dexie: IObservationRepository,
    private readonly supabase: IObservationRepository | null,
    private readonly resolveCategoryId: CategoryResolver | null
  ) {}

  private async syncToSupabase<T>(fn: () => Promise<T>): Promise<void> {
    if (this.supabase && isOnline()) {
      try {
        await fn();
      } catch (err) {
        console.warn("[DualObsRepo] Supabase sync failed (Dexie updated):", err);
      }
    }
  }

  async getById(id: number): Promise<Observation | null> {
    return this.dexie.getById(id);
  }

  async list(categoryId?: number): Promise<Observation[]> {
    return this.dexie.list(categoryId);
  }

  async create(observation: Observation): Promise<Observation> {
    const result = await this.dexie.create(observation);
    await this.syncToSupabase(async () => {
      const supabaseCatId = observation.categoryId != null && this.resolveCategoryId
        ? await this.resolveCategoryId(observation.categoryId)
        : null;
      const obsForSupabase: Observation = { ...result, categoryId: supabaseCatId ?? undefined };
      if (hasBulkUpsertObservations(this.supabase)) {
        await this.supabase.bulkUpsertObservations([obsForSupabase]);
      }
    });
    return result;
  }

  async update(id: number, updates: Partial<Observation>): Promise<Observation> {
    return this.dexie.update(id, updates);
    // Update sync deferred to periodic FullSyncService (observation id mapping is complex)
  }

  async delete(id: number): Promise<void> {
    await this.dexie.delete(id);
    // Delete sync deferred to periodic FullSyncService
  }

  async listCategories(): Promise<ObservationCategory[]> {
    return this.dexie.listCategories();
  }

  async createCategory(category: ObservationCategory): Promise<ObservationCategory> {
    const result = await this.dexie.createCategory(category);
    await this.syncToSupabase(async () => {
      if (hasBulkUpsertCategories(this.supabase)) {
        await this.supabase.bulkUpsertCategories([result]);
      }
    });
    return result;
  }

  async updateCategory(id: number, updates: Partial<ObservationCategory>): Promise<ObservationCategory> {
    const result = await this.dexie.updateCategory(id, updates);
    await this.syncToSupabase(async () => {
      if (hasBulkUpsertCategories(this.supabase)) {
        await this.supabase.bulkUpsertCategories([result]);
      }
    });
    return result;
  }

  async deleteCategory(id: number): Promise<void> {
    const cat = (await this.dexie.listCategories()).find((x) => x.id === id);
    await this.dexie.deleteCategory(id);
    await this.syncToSupabase(async () => {
      if (cat && hasGetCategoryByName(this.supabase)) {
        const supabaseCat = await this.supabase.getCategoryByName(cat.name);
        if (supabaseCat?.id && this.supabase) await this.supabase.deleteCategory(supabaseCat.id);
      }
    });
  }
}
