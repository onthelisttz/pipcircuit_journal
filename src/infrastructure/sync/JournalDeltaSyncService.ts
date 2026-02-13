import { db } from "@infrastructure/db/dexie/database";
import {
  DexieNoteRepository,
  DexieObservationRepository,
  DexieTagRepository,
  DexieTradeRepository,
} from "@infrastructure/db/dexie/repositories";
import { SupabaseNoteRepository } from "@infrastructure/db/supabase/repositories/SupabaseNoteRepository";
import { SupabaseObservationRepository } from "@infrastructure/db/supabase/repositories/SupabaseObservationRepository";
import { SupabaseTagRepository } from "@infrastructure/db/supabase/repositories/SupabaseTagRepository";
import { SupabaseTradeRepository } from "@infrastructure/db/supabase/repositories/SupabaseTradeRepository";
import { EntitySyncQueue } from "./EntitySyncQueue";
import { isOnline } from "./utils";

type JournalTable =
  | "tags"
  | "trade_notes"
  | "observations"
  | "observation_categories"
  | "trade_tags";

type ReconnectQueueResult = {
  processed: number;
  failed: number;
  deadLettered: number;
};

export type JournalDeltaProgressCallback = (step: string) => void;

export type JournalTableResult = {
  pulled: number;
  applied: number;
  deferred: number;
  watermark?: Date;
};

export type JournalDeltaPullResult = {
  success: boolean;
  error?: string;
  tables: Record<JournalTable, JournalTableResult>;
};

export type JournalReconnectResult = {
  success: boolean;
  error?: string;
  firstPull: JournalDeltaPullResult;
  queue: ReconnectQueueResult;
  secondPull: JournalDeltaPullResult;
};

type DexieTradeLike = Pick<DexieTradeRepository, "getById" | "list">;
type DexieTagLike = Pick<
  DexieTagRepository,
  | "upsertFromRemote"
  | "getByRemoteId"
  | "getByIdIncludingDeleted"
  | "update"
  | "getByClientId"
  | "deleteTradeTagByRemoteId"
  | "deleteTradeTagByClientId"
  | "upsertTradeTagFromRemote"
>;
type DexieNoteLike = Pick<
  DexieNoteRepository,
  "getByRemoteId" | "getByClientId" | "upsertFromRemote"
>;
type DexieObservationLike = Pick<
  DexieObservationRepository,
  | "upsertCategoryFromRemote"
  | "getCategoryByRemoteId"
  | "getCategoryByIdIncludingDeleted"
  | "updateCategory"
  | "getCategoryByClientId"
  | "getByRemoteId"
  | "getByClientId"
  | "upsertFromRemote"
>;
type SupabaseTradeLike = Pick<SupabaseTradeRepository, "getById">;
type SupabaseTagLike = Pick<
  SupabaseTagRepository,
  "listDeltasSince" | "listTradeTagDeltasSince" | "getById"
>;
type SupabaseNoteLike = Pick<SupabaseNoteRepository, "listDeltasSince">;
type SupabaseObservationLike = Pick<
  SupabaseObservationRepository,
  "listCategoryDeltasSince" | "listDeltasSince" | "getCategoryById"
>;

export type JournalDeltaSyncDependencies = {
  dexieTrade: DexieTradeLike;
  dexieTag: DexieTagLike;
  dexieNote: DexieNoteLike;
  dexieObs: DexieObservationLike;
  supaTrade: SupabaseTradeLike;
  supaTag: SupabaseTagLike;
  supaNote: SupabaseNoteLike;
  supaObs: SupabaseObservationLike;
  processQueue: (userId: string) => Promise<ReconnectQueueResult>;
};

const WATERMARK_SLOP_MS = 1_000;

function zeroTableResult(): JournalTableResult {
  return {
    pulled: 0,
    applied: 0,
    deferred: 0,
  };
}

function emptyPullResult(): JournalDeltaPullResult {
  return {
    success: true,
    tables: {
      tags: zeroTableResult(),
      trade_notes: zeroTableResult(),
      observations: zeroTableResult(),
      observation_categories: zeroTableResult(),
      trade_tags: zeroTableResult(),
    },
  };
}

function emptyQueueResult(): ReconnectQueueResult {
  return {
    processed: 0,
    failed: 0,
    deadLettered: 0,
  };
}

function maxDate(a: Date | undefined, b: Date): Date {
  if (!a) return b;
  return b.getTime() > a.getTime() ? b : a;
}

function toEventTime(row: {
  updatedAt?: Date;
  deletedAt?: Date | null;
  createdAt?: Date;
}): Date {
  return row.deletedAt ?? row.updatedAt ?? row.createdAt ?? new Date();
}

export class JournalDeltaSyncService {
  private readonly deps: JournalDeltaSyncDependencies;

  constructor(
    private readonly userId: string,
    dependencies: Partial<JournalDeltaSyncDependencies> = {}
  ) {
    this.deps = {
      dexieTrade: dependencies.dexieTrade ?? new DexieTradeRepository(),
      dexieTag: dependencies.dexieTag ?? new DexieTagRepository(),
      dexieNote: dependencies.dexieNote ?? new DexieNoteRepository(),
      dexieObs: dependencies.dexieObs ?? new DexieObservationRepository(),
      supaTrade: dependencies.supaTrade ?? new SupabaseTradeRepository(userId),
      supaTag: dependencies.supaTag ?? new SupabaseTagRepository(userId),
      supaNote: dependencies.supaNote ?? new SupabaseNoteRepository(userId),
      supaObs: dependencies.supaObs ?? new SupabaseObservationRepository(userId),
      processQueue: dependencies.processQueue ?? EntitySyncQueue.processQueue,
    };
  }

  async runReconnectFlow(
    onProgress?: JournalDeltaProgressCallback
  ): Promise<JournalReconnectResult> {
    const firstPull = await this.pullDeltas(onProgress);
    if (!firstPull.success) {
      return {
        success: false,
        error: firstPull.error ?? "Initial delta pull failed",
        firstPull,
        queue: emptyQueueResult(),
        secondPull: emptyPullResult(),
      };
    }

    onProgress?.("Replaying queued local changes...");
    const queue = await this.deps.processQueue(this.userId);

    onProgress?.("Finalizing with latest cloud changes...");
    const secondPull = await this.pullDeltas(onProgress);

    const queueHasErrors = queue.failed > 0 || queue.deadLettered > 0;
    const success = secondPull.success && !queueHasErrors;

    return {
      success,
      error: success
        ? undefined
        : secondPull.error ??
          (queue.deadLettered > 0
            ? `Some outbox jobs reached dead-letter (${queue.deadLettered}).`
            : queue.failed > 0
            ? `Some outbox jobs failed and are pending retry (${queue.failed}).`
            : "Reconnect sync finished with errors"),
      firstPull,
      queue,
      secondPull,
    };
  }

  async pullDeltas(
    onProgress?: JournalDeltaProgressCallback
  ): Promise<JournalDeltaPullResult> {
    if (!this.userId) {
      return {
        ...emptyPullResult(),
        success: false,
        error: "User id is required for delta sync",
      };
    }

    if (!isOnline()) {
      return {
        ...emptyPullResult(),
        success: false,
        error: "Cannot pull deltas while offline",
      };
    }

    const result = emptyPullResult();

    try {
      onProgress?.("Pulling tag changes...");
      result.tables.tags = await this.syncTags();

      onProgress?.("Pulling observation category changes...");
      result.tables.observation_categories = await this.syncObservationCategories();

      onProgress?.("Pulling observation changes...");
      result.tables.observations = await this.syncObservations();

      onProgress?.("Pulling trade note changes...");
      result.tables.trade_notes = await this.syncTradeNotes();

      onProgress?.("Pulling trade tag changes...");
      result.tables.trade_tags = await this.syncTradeTags();

      onProgress?.("pull complete.");
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ...result,
        success: false,
        error: message,
      };
    }
  }

  private async syncTags(): Promise<JournalTableResult> {
    const table = "tags";
    const currentWatermark = await this.getWatermark(table);
    const deltas = await this.deps.supaTag.listDeltasSince(
      this.toQuerySince(currentWatermark)
    );

    return this.applyDeltas(table, currentWatermark, deltas, async (tag) => {
      await this.deps.dexieTag.upsertFromRemote({
        ...tag,
        deletedAt: tag.deletedAt ?? null,
      });
      return true;
    });
  }

  private async syncObservationCategories(): Promise<JournalTableResult> {
    const table = "observation_categories";
    const currentWatermark = await this.getWatermark(table);
    const deltas = await this.deps.supaObs.listCategoryDeltasSince(
      this.toQuerySince(currentWatermark)
    );

    return this.applyDeltas(table, currentWatermark, deltas, async (category) => {
      await this.deps.dexieObs.upsertCategoryFromRemote({
        ...category,
        deletedAt: category.deletedAt ?? null,
      });
      return true;
    });
  }

  private async syncObservations(): Promise<JournalTableResult> {
    const table = "observations";
    const currentWatermark = await this.getWatermark(table);
    const deltas = await this.deps.supaObs.listDeltasSince(
      this.toQuerySince(currentWatermark)
    );

    return this.applyDeltas(table, currentWatermark, deltas, async (observation) => {
      const existing = observation.remoteId
        ? await this.deps.dexieObs.getByRemoteId(observation.remoteId, true)
        : observation.clientId
        ? await this.deps.dexieObs.getByClientId(observation.clientId, true)
        : null;

      let localCategoryId: number | null = null;
      if (observation.categoryId != null) {
        localCategoryId = await this.resolveLocalCategoryId(observation.categoryId);
        if (localCategoryId == null && !observation.deletedAt) {
          return false;
        }
      }

      await this.deps.dexieObs.upsertFromRemote({
        ...observation,
        categoryId: localCategoryId ?? existing?.categoryId ?? null,
        deletedAt: observation.deletedAt ?? null,
      });
      return true;
    });
  }

  private async syncTradeNotes(): Promise<JournalTableResult> {
    const table = "trade_notes";
    const currentWatermark = await this.getWatermark(table);
    const deltas = await this.deps.supaNote.listDeltasSince(
      this.toQuerySince(currentWatermark)
    );

    return this.applyDeltas(table, currentWatermark, deltas, async (note) => {
      const existing = note.remoteId
        ? await this.deps.dexieNote.getByRemoteId(note.remoteId, true)
        : note.clientId
        ? await this.deps.dexieNote.getByClientId(note.clientId, true)
        : null;

      const localTradeId =
        (await this.resolveLocalTradeId(note.tradeId)) ?? existing?.tradeId ?? null;
      if (localTradeId == null && !note.deletedAt) {
        return false;
      }

      await this.deps.dexieNote.upsertFromRemote({
        ...note,
        tradeId: localTradeId ?? note.tradeId,
        deletedAt: note.deletedAt ?? null,
      });
      return true;
    });
  }

  private async syncTradeTags(): Promise<JournalTableResult> {
    const table = "trade_tags";
    const currentWatermark = await this.getWatermark(table);
    const deltas = await this.deps.supaTag.listTradeTagDeltasSince(
      this.toQuerySince(currentWatermark)
    );

    return this.applyDeltas(table, currentWatermark, deltas, async (tradeTag) => {
      if (tradeTag.remoteId == null) {
        return false;
      }

      const localTradeId = await this.resolveLocalTradeId(tradeTag.tradeId);
      const localTagId = await this.resolveLocalTagId(tradeTag.tagId);

      if (localTradeId == null || localTagId == null) {
        if (tradeTag.deletedAt) {
          await this.deps.dexieTag.deleteTradeTagByRemoteId(tradeTag.remoteId);
          if (tradeTag.clientId) {
            await this.deps.dexieTag.deleteTradeTagByClientId(tradeTag.clientId);
          }
          return true;
        }
        return false;
      }

      await this.deps.dexieTag.upsertTradeTagFromRemote({
        remoteId: tradeTag.remoteId,
        clientId: tradeTag.clientId,
        tradeId: localTradeId,
        tagId: localTagId,
        createdAt: tradeTag.createdAt,
        updatedAt: tradeTag.updatedAt,
        deletedAt: tradeTag.deletedAt ?? null,
        deviceId: tradeTag.deviceId ?? null,
        version: tradeTag.version,
      });

      return true;
    });
  }

  private async applyDeltas<
    T extends { updatedAt?: Date; deletedAt?: Date | null; createdAt?: Date }
  >(
    table: JournalTable,
    currentWatermark: Date | undefined,
    rows: T[],
    apply: (row: T) => Promise<boolean>
  ): Promise<JournalTableResult> {
    let applied = 0;
    let deferred = 0;
    let nextWatermark = currentWatermark;
    let hasDeferred = false;

    for (const row of rows) {
      const success = await apply(row);
      if (success) {
        applied += 1;
        nextWatermark = maxDate(nextWatermark, toEventTime(row));
      } else {
        deferred += 1;
        hasDeferred = true;
      }
    }

    const persistedWatermark = !hasDeferred ? nextWatermark : undefined;
    if (persistedWatermark) {
      const changed =
        currentWatermark == null ||
        persistedWatermark.getTime() !== currentWatermark.getTime();
      if (changed) {
        await this.setWatermark(table, persistedWatermark);
      }
    }

    return {
      pulled: rows.length,
      applied,
      deferred,
      watermark: persistedWatermark ?? currentWatermark,
    };
  }

  private async resolveLocalTradeId(remoteTradeId: number): Promise<number | null> {
    const direct = await this.deps.dexieTrade.getById(remoteTradeId);
    if (direct?.id != null) {
      return direct.id;
    }

    const remoteTrade = await this.deps.supaTrade.getById(remoteTradeId);
    if (!remoteTrade?.accountId || !remoteTrade.ticketId) {
      return null;
    }

    const localTrades = await this.deps.dexieTrade.list({
      accountId: remoteTrade.accountId,
    });
    const match = localTrades.find((trade) => trade.ticketId === remoteTrade.ticketId);
    return match?.id ?? null;
  }

  private async resolveLocalTagId(remoteTagId: number): Promise<number | null> {
    const byRemote = await this.deps.dexieTag.getByRemoteId(remoteTagId, true);
    if (byRemote?.id != null) {
      return byRemote.id;
    }

    const byLegacy = await this.deps.dexieTag.getByIdIncludingDeleted(remoteTagId);
    if (byLegacy?.id != null) {
      if (byLegacy.remoteId == null) {
        await this.deps.dexieTag.update(byLegacy.id, { remoteId: remoteTagId });
      }
      return byLegacy.id;
    }

    const remote = await this.deps.supaTag.getById(remoteTagId);
    if (!remote?.clientId) {
      return null;
    }

    const byClient = await this.deps.dexieTag.getByClientId(remote.clientId, true);
    if (byClient?.id != null) {
      if (byClient.remoteId == null) {
        await this.deps.dexieTag.update(byClient.id, { remoteId: remoteTagId });
      }
      return byClient.id;
    }

    return null;
  }

  private async resolveLocalCategoryId(
    remoteCategoryId: number
  ): Promise<number | null> {
    const byRemote = await this.deps.dexieObs.getCategoryByRemoteId(
      remoteCategoryId,
      true
    );
    if (byRemote?.id != null) {
      return byRemote.id;
    }

    const byLegacy = await this.deps.dexieObs.getCategoryByIdIncludingDeleted(
      remoteCategoryId
    );
    if (byLegacy?.id != null) {
      if (byLegacy.remoteId == null) {
        await this.deps.dexieObs.updateCategory(byLegacy.id, {
          remoteId: remoteCategoryId,
        });
      }
      return byLegacy.id;
    }

    const remote = await this.deps.supaObs.getCategoryById(remoteCategoryId);
    if (!remote) {
      return null;
    }

    if (remote.clientId) {
      const byClient = await this.deps.dexieObs.getCategoryByClientId(
        remote.clientId,
        true
      );
      if (byClient?.id != null) {
        if (byClient.remoteId == null) {
          await this.deps.dexieObs.updateCategory(byClient.id, {
            remoteId: remoteCategoryId,
          });
        }
        return byClient.id;
      }
    }

    const created = await this.deps.dexieObs.upsertCategoryFromRemote({
      ...remote,
      deletedAt: remote.deletedAt ?? null,
    });
    return created.id ?? null;
  }

  private metaKey(table: JournalTable): string {
    return `journal:${this.userId}:${table}`;
  }

  private async getWatermark(table: JournalTable): Promise<Date | undefined> {
    const record = await db.sync_meta.get(this.metaKey(table));
    const value = record?.lastSyncTime;
    return value ? new Date(value) : undefined;
  }

  private async setWatermark(table: JournalTable, watermark: Date): Promise<void> {
    await db.sync_meta.put({
      key: this.metaKey(table),
      userId: this.userId,
      accountId: `journal:${table}`,
      lastSyncTime: watermark,
    });
  }

  private toQuerySince(watermark: Date | undefined): Date | undefined {
    if (!watermark) return undefined;
    return new Date(watermark.getTime() - WATERMARK_SLOP_MS);
  }
}
