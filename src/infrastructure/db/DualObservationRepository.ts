import type { IObservationRepository } from "@application/ports/repositories";
import type { Observation, ObservationCategory } from "@domain/entities";
import { isOnline } from "@infrastructure/sync/utils/connection";
import { EntitySyncQueue } from "@infrastructure/sync/EntitySyncQueue";

type CategoryResolver = (dexieCategoryId: number) => Promise<number | null>;

type ObservationCategoryLookupRepo = IObservationRepository & {
  getCategoryByClientId: (clientId: string) => Promise<ObservationCategory | null>;
  getCategoryById: (id: number) => Promise<ObservationCategory | null>;
  getCategoryByName: (name: string) => Promise<ObservationCategory | null>;
};

type ObservationLookupRepo = IObservationRepository & {
  getByClientId: (clientId: string) => Promise<Observation | null>;
  findByCreatedAtAndTitle: (createdAt: Date, title: string) => Promise<Observation | null>;
};

const hasGetByClientId = (
  repo: IObservationRepository | null
): repo is ObservationLookupRepo =>
  Boolean(repo && typeof (repo as ObservationLookupRepo).getByClientId === "function");

const hasGetCategoryByClientId = (
  repo: IObservationRepository | null
): repo is ObservationCategoryLookupRepo =>
  Boolean(
    repo &&
      typeof (repo as ObservationCategoryLookupRepo).getCategoryByClientId === "function"
  );

const hasGetCategoryById = (
  repo: IObservationRepository | null
): repo is ObservationCategoryLookupRepo =>
  Boolean(
    repo && typeof (repo as ObservationCategoryLookupRepo).getCategoryById === "function"
  );

const hasGetCategoryByName = (
  repo: IObservationRepository | null
): repo is ObservationCategoryLookupRepo =>
  Boolean(
    repo && typeof (repo as ObservationCategoryLookupRepo).getCategoryByName === "function"
  );

const hasFindByCreatedAtAndTitle = (
  repo: IObservationRepository | null
): repo is ObservationLookupRepo =>
  Boolean(
    repo &&
      typeof (repo as ObservationLookupRepo).findByCreatedAtAndTitle === "function"
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

  private async syncToSupabase<T>(
    fn: () => Promise<T>,
    onFallback?: () => Promise<void>
  ): Promise<boolean> {
    if (!this.supabase || !isOnline()) {
      if (onFallback) await onFallback();
      return false;
    }

    try {
      await fn();
      return true;
    } catch (err) {
      console.warn("[DualObsRepo] Supabase sync failed (Dexie updated):", err);
      if (onFallback) await onFallback();
      return false;
    }
  }

  private async resolveRemoteObservation(
    observation: Observation
  ): Promise<Observation | null> {
    if (!this.supabase) return null;

    if (observation.clientId && hasGetByClientId(this.supabase)) {
      const byClientId = await this.supabase.getByClientId(observation.clientId);
      if (byClientId) return byClientId;
    }

    if (observation.remoteId != null) {
      const byId = await this.supabase.getById(observation.remoteId);
      if (byId) return byId;
    }

    if (hasFindByCreatedAtAndTitle(this.supabase)) {
      return this.supabase.findByCreatedAtAndTitle(
        observation.createdAt instanceof Date
          ? observation.createdAt
          : new Date(observation.createdAt),
        observation.title
      );
    }
    return null;
  }

  private async resolveLocalCategoryIdFromRemote(
    remoteCategoryId: number | null | undefined
  ): Promise<number | null> {
    if (remoteCategoryId == null) return null;

    const categories = await this.dexie.listCategories();
    const byRemote = categories.find((cat) => cat.remoteId === remoteCategoryId);
    if (byRemote?.id != null) {
      return byRemote.id;
    }

    const byLegacyId = categories.find((cat) => cat.id === remoteCategoryId);
    if (byLegacyId?.id != null) {
      if (byLegacyId.remoteId == null) {
        await this.dexie.updateCategory(byLegacyId.id, { remoteId: remoteCategoryId });
      }
      return byLegacyId.id;
    }

    return null;
  }

  async getById(id: number): Promise<Observation | null> {
    return this.dexie.getById(id);
  }

  async list(categoryId?: number): Promise<Observation[]> {
    return this.dexie.list(categoryId);
  }

  async create(observation: Observation): Promise<Observation> {
    const result = await this.dexie.create(observation);

    await this.syncToSupabase(
      async () => {
        const supabaseCatId =
          observation.categoryId != null && this.resolveCategoryId
            ? await this.resolveCategoryId(observation.categoryId)
            : null;
        const created = await this.supabase!.create({
          ...result,
          categoryId: supabaseCatId ?? undefined,
          deletedAt: null,
        });
        if (result.id != null) {
          await this.dexie.update(result.id, {
            remoteId: created.id ?? created.remoteId,
            clientId: created.clientId ?? result.clientId,
            updatedAt: created.updatedAt,
            syncedAt: new Date(),
            deletedAt: created.deletedAt ?? null,
            version: created.version,
          });
        }
      },
      async () => {
        if (result.id != null) {
          await EntitySyncQueue.queueObservationUpsert({ localId: result.id });
        }
      }
    );

    return result;
  }

  async update(id: number, updates: Partial<Observation>): Promise<Observation> {
    const result = await this.dexie.update(id, updates);

    await this.syncToSupabase(
      async () => {
        const remote = await this.resolveRemoteObservation(result);

        if (remote && remote.updatedAt > result.updatedAt) {
          const localCategoryId = await this.resolveLocalCategoryIdFromRemote(
            remote.categoryId ?? null
          );
          await this.dexie.update(id, {
            title: remote.title,
            content: remote.content,
            categoryId: localCategoryId,
            source: remote.source ?? "manual",
            chartContext: remote.chartContext ?? null,
            updatedAt: remote.updatedAt,
            syncedAt: remote.syncedAt,
            version: remote.version,
            remoteId: remote.id ?? remote.remoteId,
          });
          return;
        }

        const supabaseCatId =
          result.categoryId != null && this.resolveCategoryId
            ? await this.resolveCategoryId(result.categoryId)
            : null;

        const synced = remote
          ? await this.supabase!.update(remote.id!, {
              clientId: result.clientId,
              title: result.title,
              content: result.content,
              categoryId: supabaseCatId ?? null,
              source: result.source ?? "manual",
              chartContext: result.chartContext ?? null,
              updatedAt: result.updatedAt,
              deletedAt: null,
              version: result.version,
            })
          : await this.supabase!.create({
              ...result,
              categoryId: supabaseCatId ?? null,
              deletedAt: null,
            });

        await this.dexie.update(id, {
          remoteId: synced.id ?? synced.remoteId,
          clientId: synced.clientId ?? result.clientId,
          updatedAt: synced.updatedAt,
          syncedAt: new Date(),
          deletedAt: synced.deletedAt ?? null,
          version: synced.version,
        });
      },
      async () => {
        await EntitySyncQueue.queueObservationUpsert({ localId: id });
      }
    );

    return result;
  }

  async delete(id: number): Promise<void> {
    const local = await this.dexie.getById(id);
    await this.dexie.delete(id);

    await this.syncToSupabase(
      async () => {
        if (!local) return;
        const remote = await this.resolveRemoteObservation(local);
        if (remote?.id != null) {
          await this.supabase!.delete(remote.id);
        }
      },
      async () => {
        await EntitySyncQueue.queueObservationDelete(
          {
            localId: id,
            clientId: local?.clientId,
            remoteId: local?.remoteId,
            createdAt:
              local?.createdAt instanceof Date
                ? local.createdAt.toISOString()
                : local?.createdAt
                ? new Date(local.createdAt).toISOString()
                : undefined,
            title: local?.title,
          },
          id
        );
      }
    );
  }

  async listCategories(): Promise<ObservationCategory[]> {
    return this.dexie.listCategories();
  }

  async createCategory(category: ObservationCategory): Promise<ObservationCategory> {
    const result = await this.dexie.createCategory(category);

    await this.syncToSupabase(
      async () => {
        let remote = result.clientId && hasGetCategoryByClientId(this.supabase)
          ? await this.supabase.getCategoryByClientId(result.clientId)
          : null;
        if (!remote && hasGetCategoryByName(this.supabase)) {
          remote = await this.supabase.getCategoryByName(result.name);
        }
        if (!remote) {
          remote = await this.supabase!.createCategory(result);
        }
        if (result.id != null && remote?.id != null) {
          await this.dexie.updateCategory(result.id, {
            remoteId: remote.id,
            clientId: remote.clientId ?? result.clientId,
            updatedAt: remote.updatedAt,
            syncedAt: new Date(),
            deletedAt: remote.deletedAt ?? null,
            version: remote.version,
          });
        }
      },
      async () => {
        if (result.id != null) {
          await EntitySyncQueue.queueObservationCategoryUpsert({
            localId: result.id,
          });
        }
      }
    );

    return result;
  }

  async updateCategory(id: number, updates: Partial<ObservationCategory>): Promise<ObservationCategory> {
    const previous = (await this.dexie.listCategories()).find((x) => x.id === id) ?? null;
    const result = await this.dexie.updateCategory(id, updates);

    await this.syncToSupabase(
      async () => {
        let remote: ObservationCategory | null = null;
        if (previous?.clientId && hasGetCategoryByClientId(this.supabase)) {
          remote = await this.supabase.getCategoryByClientId(previous.clientId);
        }
        if (!remote && previous?.remoteId != null && hasGetCategoryById(this.supabase)) {
          remote = await this.supabase.getCategoryById(previous.remoteId);
        }
        if (!remote && previous && hasGetCategoryByName(this.supabase)) {
          remote = await this.supabase.getCategoryByName(previous.name);
        }
        if (!remote && hasGetCategoryByName(this.supabase)) {
          remote = await this.supabase.getCategoryByName(result.name);
        }

        if (remote && remote.updatedAt > result.updatedAt) {
          await this.dexie.updateCategory(id, {
            ...remote,
            remoteId: remote.id,
          });
          return;
        }

        const synced = remote
          ? await this.supabase!.updateCategory(remote.id!, {
              clientId: result.clientId,
              name: result.name,
              color: result.color,
              updatedAt: result.updatedAt,
              deletedAt: null,
              version: result.version,
            })
          : await this.supabase!.createCategory(result);

        await this.dexie.updateCategory(id, {
          remoteId: synced.id ?? synced.remoteId,
          clientId: synced.clientId ?? result.clientId,
          updatedAt: synced.updatedAt,
          syncedAt: new Date(),
          deletedAt: synced.deletedAt ?? null,
          version: synced.version,
        });
      },
      async () => {
        await EntitySyncQueue.queueObservationCategoryUpsert({
          localId: id,
          previousName: previous?.name,
        });
      }
    );

    return result;
  }

  async deleteCategory(id: number): Promise<void> {
    const cat = (await this.dexie.listCategories()).find((x) => x.id === id);
    await this.dexie.deleteCategory(id);

    await this.syncToSupabase(
      async () => {
        if (cat?.clientId && hasGetCategoryByClientId(this.supabase)) {
          const remote = await this.supabase.getCategoryByClientId(cat.clientId);
          if (remote?.id) {
            await this.supabase!.deleteCategory(remote.id);
            return;
          }
        }
        if (cat?.remoteId != null && hasGetCategoryById(this.supabase)) {
          const remote = await this.supabase.getCategoryById(cat.remoteId);
          if (remote?.id) {
            await this.supabase!.deleteCategory(remote.id);
            return;
          }
        }
        if (cat && hasGetCategoryByName(this.supabase)) {
          const supabaseCat = await this.supabase.getCategoryByName(cat.name);
          if (supabaseCat?.id) await this.supabase!.deleteCategory(supabaseCat.id);
        }
      },
      async () => {
        await EntitySyncQueue.queueObservationCategoryDelete(
          {
            localId: id,
            clientId: cat?.clientId,
            remoteId: cat?.remoteId,
            name: cat?.name,
          },
          id
        );
      }
    );
  }
}
