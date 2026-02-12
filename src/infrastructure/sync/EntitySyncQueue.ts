import { SyncAction, SyncStatus, type TagCategory } from "@domain/enums";
import type { Observation, SyncJob, TradeNote } from "@domain/entities";
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
import { createUuid, getOrCreateDeviceId, isOnline } from "./utils";

type SyncTable =
  | "tags"
  | "trade_notes"
  | "observations"
  | "observation_categories"
  | "trade_tags_replace";

type TagUpsertPayload = {
  localId: number;
  previousName?: string;
  previousCategory?: TagCategory;
};

type TagDeletePayload = {
  localId?: number;
  remoteId?: number;
  clientId?: string;
  name?: string;
  category?: TagCategory;
};

type NoteUpsertPayload = { localId: number };
type NoteDeletePayload = {
  localId?: number;
  remoteId?: number;
  clientId?: string;
  localTradeId?: number;
  createdAt?: string;
};

type ObservationUpsertPayload = { localId: number };
type ObservationDeletePayload = {
  localId?: number;
  remoteId?: number;
  clientId?: string;
  createdAt?: string;
  title?: string;
};

type ObservationCategoryUpsertPayload = {
  localId: number;
  previousName?: string;
};

type ObservationCategoryDeletePayload = {
  localId?: number;
  remoteId?: number;
  clientId?: string;
  name?: string;
};

type TradeTagsReplacePayload = {
  tradeId: number;
  tagIds: number[];
};

type QueueStats = {
  pending: number;
  retrying: number;
  syncing: number;
  failed: number;
};

const MAX_RETRIES = 8;
const BASE_BACKOFF_MS = 15_000;
const MAX_BACKOFF_MS = 30 * 60_000;
const RETRY_JITTER_MS = 2_000;

function toDate(value: Date | string | undefined | null): Date {
  if (value instanceof Date) return value;
  if (value == null) return new Date(0);
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : new Date(0);
}

function shouldUseRemoteFirst(
  localUpdatedAt: Date | string | undefined | null,
  remoteUpdatedAt: Date | string | undefined | null
): boolean {
  return toDate(remoteUpdatedAt).getTime() > toDate(localUpdatedAt).getTime();
}

function isDeleted(value: { deletedAt?: Date | string | null } | null | undefined): boolean {
  return Boolean(value?.deletedAt);
}

function hasPendingLocalTextChanges(local: {
  updatedAt?: Date | string | null;
  syncedAt?: Date | string | null;
}): boolean {
  return toDate(local.updatedAt).getTime() > toDate(local.syncedAt).getTime();
}

function nextRetryDate(retryCount: number): Date {
  const exponential = Math.min(
    BASE_BACKOFF_MS * Math.pow(2, Math.max(retryCount - 1, 0)),
    MAX_BACKOFF_MS
  );
  const jitter = Math.floor(Math.random() * RETRY_JITTER_MS);
  return new Date(Date.now() + exponential + jitter);
}

type QueueContext = {
  dexieTrade: DexieTradeRepository;
  dexieTag: DexieTagRepository;
  dexieNote: DexieNoteRepository;
  dexieObs: DexieObservationRepository;
  supaTrade: SupabaseTradeRepository;
  supaTag: SupabaseTagRepository;
  supaNote: SupabaseNoteRepository;
  supaObs: SupabaseObservationRepository;
};

export class EntitySyncQueue {
  static async queueTagUpsert(payload: TagUpsertPayload): Promise<void> {
    await this.enqueue("tags", SyncAction.Update, `tag:${payload.localId}`, payload);
  }

  static async queueTagDelete(payload: TagDeletePayload, localId?: number): Promise<void> {
    const entityId = payload.clientId
      ? `tag_client:${payload.clientId}`
      : `tag:${localId ?? payload.localId ?? payload.remoteId ?? "unknown"}`;
    await this.enqueue("tags", SyncAction.Delete, entityId, payload);
  }

  static async queueNoteUpsert(payload: NoteUpsertPayload): Promise<void> {
    await this.enqueue("trade_notes", SyncAction.Update, `note:${payload.localId}`, payload);
  }

  static async queueNoteDelete(payload: NoteDeletePayload, localId?: number): Promise<void> {
    const entityId = payload.clientId
      ? `note_client:${payload.clientId}`
      : `note:${localId ?? payload.localId ?? payload.remoteId ?? "unknown"}`;
    await this.enqueue("trade_notes", SyncAction.Delete, entityId, payload);
  }

  static async queueObservationUpsert(payload: ObservationUpsertPayload): Promise<void> {
    await this.enqueue("observations", SyncAction.Update, `obs:${payload.localId}`, payload);
  }

  static async queueObservationDelete(
    payload: ObservationDeletePayload,
    localId?: number
  ): Promise<void> {
    const entityId = payload.clientId
      ? `obs_client:${payload.clientId}`
      : `obs:${localId ?? payload.localId ?? payload.remoteId ?? "unknown"}`;
    await this.enqueue("observations", SyncAction.Delete, entityId, payload);
  }

  static async queueObservationCategoryUpsert(
    payload: ObservationCategoryUpsertPayload
  ): Promise<void> {
    await this.enqueue(
      "observation_categories",
      SyncAction.Update,
      `obs_cat:${payload.localId}`,
      payload
    );
  }

  static async queueObservationCategoryDelete(
    payload: ObservationCategoryDeletePayload,
    localId?: number
  ): Promise<void> {
    const entityId = payload.clientId
      ? `obs_cat_client:${payload.clientId}`
      : `obs_cat:${localId ?? payload.localId ?? payload.remoteId ?? "unknown"}`;
    await this.enqueue(
      "observation_categories",
      SyncAction.Delete,
      entityId,
      payload
    );
  }

  static async queueTradeTagsReplace(payload: TradeTagsReplacePayload): Promise<void> {
    await this.enqueue(
      "trade_tags_replace",
      SyncAction.Update,
      `trade_tags:${payload.tradeId}`,
      payload
    );
  }

  static async getStats(): Promise<QueueStats> {
    const jobs = await db.sync_queue
      .filter((job) => job.table !== "chart_bars")
      .toArray();

    return {
      pending: jobs.filter((job) => job.status === SyncStatus.Pending && (job.retryCount ?? 0) === 0)
        .length,
      retrying: jobs.filter((job) => job.status === SyncStatus.Pending && (job.retryCount ?? 0) > 0)
        .length,
      syncing: jobs.filter((job) => job.status === SyncStatus.Syncing).length,
      failed: jobs.filter((job) => job.status === SyncStatus.Error).length,
    };
  }

  static async retryFailed(): Promise<number> {
    const failed = await db.sync_queue.where("status").equals(SyncStatus.Error).toArray();
    for (const job of failed) {
      if (!job.id || job.table === "chart_bars") continue;
      await db.sync_queue.update(job.id, {
        status: SyncStatus.Pending,
        retryCount: 0,
        lastError: null,
        nextRetryAt: null,
        deadLetterAt: null,
      });
    }
    return failed.filter((job) => job.table !== "chart_bars").length;
  }

  static async processQueue(
    userId: string
  ): Promise<{ processed: number; failed: number; deadLettered: number }> {
    if (!userId || !isOnline()) {
      return { processed: 0, failed: 0, deadLettered: 0 };
    }

    const now = Date.now();
    const pending = await db.sync_queue
      .filter(
        (job) =>
          job.table !== "chart_bars" &&
          job.status === SyncStatus.Pending &&
          (!job.nextRetryAt || new Date(job.nextRetryAt).getTime() <= now)
      )
      .toArray();

    const jobs = pending.sort(
      (a, b) => toDate(a.timestamp).getTime() - toDate(b.timestamp).getTime()
    );

    if (jobs.length === 0) {
      return { processed: 0, failed: 0, deadLettered: 0 };
    }

    const context = this.createContext(userId);
    let processed = 0;
    let failed = 0;
    let deadLettered = 0;

    for (const job of jobs) {
      if (!job.id) continue;

      try {
        await db.sync_queue.update(job.id, {
          status: SyncStatus.Syncing,
          lastError: null,
          lastAttemptAt: new Date(),
        });

        await this.processJob(context, job);

        await db.sync_queue.delete(job.id);
        processed += 1;
      } catch (error) {
        const retryCount = (job.retryCount ?? 0) + 1;
        const lastError = error instanceof Error ? error.message : String(error);
        const isDeadLetter = retryCount >= MAX_RETRIES;

        await db.sync_queue.update(job.id, {
          status: isDeadLetter ? SyncStatus.Error : SyncStatus.Pending,
          retryCount,
          lastError,
          nextRetryAt: isDeadLetter ? null : nextRetryDate(retryCount),
          deadLetterAt: isDeadLetter ? new Date() : null,
        });

        if (isDeadLetter) {
          deadLettered += 1;
        } else {
          failed += 1;
        }
      }
    }

    return { processed, failed, deadLettered };
  }

  private static async enqueue(
    table: SyncTable,
    action: SyncAction,
    entityId: string,
    payload: Record<string, unknown>
  ): Promise<void> {
    const existing = await db.sync_queue
      .filter(
        (job) =>
          job.table === table &&
          String(job.entityId ?? "") === entityId
      )
      .first();

    const now = new Date();
    if (existing?.id) {
      await db.sync_queue.update(existing.id, {
        action,
        payload,
        timestamp: now,
        retryCount: 0,
        status: SyncStatus.Pending,
        lastError: null,
        nextRetryAt: null,
        deadLetterAt: null,
      });
      return;
    }

    const job: SyncJob = {
      action,
      table,
      entityId,
      payload,
      timestamp: now,
      retryCount: 0,
      status: SyncStatus.Pending,
      lastError: null,
      nextRetryAt: null,
      deadLetterAt: null,
    };
    await db.sync_queue.add(job);
  }

  private static createContext(userId: string) {
    return {
      dexieTrade: new DexieTradeRepository(),
      dexieTag: new DexieTagRepository(),
      dexieNote: new DexieNoteRepository(),
      dexieObs: new DexieObservationRepository(),
      supaTrade: new SupabaseTradeRepository(userId),
      supaTag: new SupabaseTagRepository(userId),
      supaNote: new SupabaseNoteRepository(userId),
      supaObs: new SupabaseObservationRepository(userId),
    };
  }

  private static async processJob(context: QueueContext, job: SyncJob): Promise<void> {
    switch (job.table as SyncTable) {
      case "tags":
        await this.processTagJob(context, job);
        break;
      case "trade_notes":
        await this.processNoteJob(context, job);
        break;
      case "observations":
        await this.processObservationJob(context, job);
        break;
      case "observation_categories":
        await this.processObservationCategoryJob(context, job);
        break;
      case "trade_tags_replace":
        await this.processTradeTagsReplaceJob(context, job);
        break;
      default:
        break;
    }
  }

  private static async processTagJob(context: QueueContext, job: SyncJob): Promise<void> {
    if (job.action === SyncAction.Delete) {
      await this.processTagDelete(context, (job.payload ?? {}) as TagDeletePayload);
      return;
    }

    const payload = (job.payload ?? {}) as TagUpsertPayload;
    const local = await context.dexieTag.getByIdIncludingDeleted(payload.localId);
    if (!local?.id) return;

    if (isDeleted(local)) {
      await this.processTagDelete(context, {
        localId: local.id,
        remoteId: local.remoteId,
        clientId: local.clientId,
        name: local.name,
        category: local.category,
      });
      return;
    }

    let remote =
      local.clientId ? await context.supaTag.getByClientId(local.clientId) : null;
    if (!remote && local.remoteId != null) {
      remote = await context.supaTag.getById(local.remoteId);
    }
    if (!remote && payload.previousName && payload.previousCategory) {
      remote = await context.supaTag.getByNameAndCategory(
        payload.previousName,
        payload.previousCategory
      );
    }
    if (!remote) {
      remote = await context.supaTag.getByNameAndCategory(local.name, local.category);
    }

    if (remote && isDeleted(remote)) {
      await context.dexieTag.delete(local.id);
      return;
    }

    if (remote && shouldUseRemoteFirst(local.updatedAt, remote.updatedAt)) {
      await context.dexieTag.update(local.id, {
        remoteId: remote.id,
        clientId: remote.clientId,
        name: remote.name,
        category: remote.category,
        color: remote.color,
        updatedAt: remote.updatedAt,
        deletedAt: remote.deletedAt ?? null,
        syncedAt: remote.syncedAt ?? null,
        version: remote.version,
      });
      return;
    }

    const synced = remote
      ? await context.supaTag.update(remote.id!, {
          clientId: local.clientId,
          name: local.name,
          category: local.category,
          color: local.color,
          updatedAt: local.updatedAt,
          deletedAt: null,
          version: local.version,
        })
      : await context.supaTag.create(local);

    await context.dexieTag.update(local.id, {
      remoteId: synced.id ?? synced.remoteId,
      clientId: synced.clientId ?? local.clientId,
      updatedAt: synced.updatedAt,
      syncedAt: new Date(),
      deletedAt: synced.deletedAt ?? null,
      version: synced.version,
    });
  }

  private static async processTagDelete(
    context: QueueContext,
    payload: TagDeletePayload
  ): Promise<void> {
    let remote = payload.clientId
      ? await context.supaTag.getByClientId(payload.clientId)
      : null;
    if (!remote && payload.remoteId != null) {
      remote = await context.supaTag.getById(payload.remoteId);
    }
    if (!remote && payload.name && payload.category) {
      remote = await context.supaTag.getByNameAndCategory(payload.name, payload.category);
    }
    if (remote?.id) {
      await context.supaTag.delete(remote.id);
    }
  }

  private static async processNoteJob(context: QueueContext, job: SyncJob): Promise<void> {
    if (job.action === SyncAction.Delete) {
      await this.processNoteDelete(context, (job.payload ?? {}) as NoteDeletePayload);
      return;
    }

    const payload = (job.payload ?? {}) as NoteUpsertPayload;
    const local = await context.dexieNote.getByIdIncludingDeleted(payload.localId);
    if (!local?.id) return;

    if (isDeleted(local)) {
      await this.processNoteDelete(context, {
        localId: local.id,
        remoteId: local.remoteId,
        clientId: local.clientId,
        localTradeId: local.tradeId,
        createdAt: toDate(local.createdAt).toISOString(),
      });
      return;
    }

    const supabaseTradeId = await this.resolveSupabaseTradeId(context, local.tradeId);
    if (supabaseTradeId == null) {
      throw new Error("Could not resolve trade in cloud for note sync");
    }

    let remote = local.clientId
      ? await context.supaNote.getByClientId(local.clientId)
      : null;
    if (!remote && local.remoteId != null) {
      remote = await context.supaNote.getById(local.remoteId);
    }
    if (!remote) {
      remote = await context.supaNote.findByTradeAndCreatedAt(
        supabaseTradeId,
        toDate(local.createdAt)
      );
    }

    if (remote && isDeleted(remote)) {
      await context.dexieNote.hardDelete(local.id);
      return;
    }

    if (remote && shouldUseRemoteFirst(local.updatedAt, remote.updatedAt)) {
      if (hasPendingLocalTextChanges(local) && local.content !== remote.content) {
        await this.createNoteConflictCopy(context, local);
      }

      const localTradeId = await this.resolveLocalTradeId(context, remote.tradeId);
      await context.dexieNote.update(local.id, {
        remoteId: remote.id,
        clientId: remote.clientId,
        tradeId: localTradeId ?? local.tradeId,
        content: remote.content,
        updatedAt: remote.updatedAt,
        syncedAt: remote.syncedAt,
        deletedAt: remote.deletedAt ?? null,
        version: remote.version,
      });
      return;
    }

    const payloadNote: TradeNote = {
      ...local,
      tradeId: supabaseTradeId,
      deletedAt: null,
    };
    const synced = remote
      ? await context.supaNote.update(remote.id!, {
          clientId: local.clientId,
          content: payloadNote.content,
          updatedAt: payloadNote.updatedAt,
          syncedAt: new Date(),
          deletedAt: null,
          version: payloadNote.version,
        })
      : await context.supaNote.create(payloadNote);

    await context.dexieNote.update(local.id, {
      remoteId: synced.id ?? synced.remoteId,
      clientId: synced.clientId ?? local.clientId,
      syncedAt: new Date(),
      updatedAt: synced.updatedAt,
      deletedAt: synced.deletedAt ?? null,
      version: synced.version,
    });
  }

  private static async processNoteDelete(
    context: QueueContext,
    payload: NoteDeletePayload
  ): Promise<void> {
    let remote = payload.clientId
      ? await context.supaNote.getByClientId(payload.clientId)
      : null;
    if (!remote && payload.remoteId != null) {
      remote = await context.supaNote.getById(payload.remoteId);
    }
    if (!remote && payload.localTradeId != null && payload.createdAt) {
      const supabaseTradeId = await this.resolveSupabaseTradeId(
        context,
        payload.localTradeId
      );
      if (supabaseTradeId != null) {
        remote = await context.supaNote.findByTradeAndCreatedAt(
          supabaseTradeId,
          new Date(payload.createdAt)
        );
      }
    }
    if (remote?.id) {
      await context.supaNote.delete(remote.id);
    }
  }

  private static async processObservationJob(
    context: QueueContext,
    job: SyncJob
  ): Promise<void> {
    if (job.action === SyncAction.Delete) {
      await this.processObservationDelete(
        context,
        (job.payload ?? {}) as ObservationDeletePayload
      );
      return;
    }

    const payload = (job.payload ?? {}) as ObservationUpsertPayload;
    const local = await context.dexieObs.getByIdIncludingDeleted(payload.localId);
    if (!local?.id) return;

    if (isDeleted(local)) {
      await this.processObservationDelete(context, {
        localId: local.id,
        remoteId: local.remoteId,
        clientId: local.clientId,
        createdAt: toDate(local.createdAt).toISOString(),
        title: local.title,
      });
      return;
    }

    let remote = local.clientId
      ? await context.supaObs.getByClientId(local.clientId)
      : null;
    if (!remote && local.remoteId != null) {
      remote = await context.supaObs.getById(local.remoteId);
    }
    if (!remote) {
      remote = await context.supaObs.findByCreatedAtAndTitle(
        toDate(local.createdAt),
        local.title
      );
    }

    if (remote && isDeleted(remote)) {
      await context.dexieObs.hardDelete(local.id);
      return;
    }

    if (remote && shouldUseRemoteFirst(local.updatedAt, remote.updatedAt)) {
      if (hasPendingLocalTextChanges(local) && local.content !== remote.content) {
        await this.createObservationConflictCopy(context, local);
      }

      const localCategoryId = await this.resolveLocalCategoryId(
        context,
        remote.categoryId ?? null
      );
      await context.dexieObs.update(local.id, {
        remoteId: remote.id,
        clientId: remote.clientId,
        title: remote.title,
        content: remote.content,
        categoryId: localCategoryId,
        updatedAt: remote.updatedAt,
        syncedAt: remote.syncedAt,
        deletedAt: remote.deletedAt ?? null,
        version: remote.version,
      });
      return;
    }

    const supabaseCategoryId = await this.resolveSupabaseCategoryId(
      context,
      local.categoryId ?? null
    );

    const payloadObs: Observation = {
      ...local,
      categoryId: supabaseCategoryId ?? null,
      deletedAt: null,
    };

    const synced = remote
      ? await context.supaObs.update(remote.id!, {
          clientId: local.clientId,
          title: payloadObs.title,
          content: payloadObs.content,
          categoryId: payloadObs.categoryId,
          updatedAt: payloadObs.updatedAt,
          deletedAt: null,
          version: payloadObs.version,
        })
      : await context.supaObs.create(payloadObs);

    await context.dexieObs.update(local.id, {
      remoteId: synced.id ?? synced.remoteId,
      clientId: synced.clientId ?? local.clientId,
      updatedAt: synced.updatedAt,
      syncedAt: new Date(),
      deletedAt: synced.deletedAt ?? null,
      version: synced.version,
    });
  }

  private static async processObservationDelete(
    context: QueueContext,
    payload: ObservationDeletePayload
  ): Promise<void> {
    let remote = payload.clientId
      ? await context.supaObs.getByClientId(payload.clientId)
      : null;
    if (!remote && payload.remoteId != null) {
      remote = await context.supaObs.getById(payload.remoteId);
    }
    if (!remote && payload.createdAt && payload.title) {
      remote = await context.supaObs.findByCreatedAtAndTitle(
        new Date(payload.createdAt),
        payload.title
      );
    }
    if (remote?.id) {
      await context.supaObs.delete(remote.id);
    }
  }

  private static async processObservationCategoryJob(
    context: QueueContext,
    job: SyncJob
  ): Promise<void> {
    if (job.action === SyncAction.Delete) {
      await this.processObservationCategoryDelete(
        context,
        (job.payload ?? {}) as ObservationCategoryDeletePayload
      );
      return;
    }

    const payload = (job.payload ?? {}) as ObservationCategoryUpsertPayload;
    const local = await context.dexieObs.getCategoryByIdIncludingDeleted(payload.localId);
    if (!local?.id) return;

    if (isDeleted(local)) {
      await this.processObservationCategoryDelete(context, {
        localId: local.id,
        remoteId: local.remoteId,
        clientId: local.clientId,
        name: local.name,
      });
      return;
    }

    let remote = local.clientId
      ? await context.supaObs.getCategoryByClientId(local.clientId)
      : null;
    if (!remote && local.remoteId != null) {
      remote = await context.supaObs.getCategoryById(local.remoteId);
    }
    if (!remote && payload.previousName) {
      remote = await context.supaObs.getCategoryByName(payload.previousName);
    }
    if (!remote) {
      remote = await context.supaObs.getCategoryByName(local.name);
    }

    if (remote && isDeleted(remote)) {
      await context.dexieObs.hardDeleteCategory(local.id);
      return;
    }

    if (remote && shouldUseRemoteFirst(local.updatedAt, remote.updatedAt)) {
      await context.dexieObs.updateCategory(local.id, {
        remoteId: remote.id,
        clientId: remote.clientId,
        name: remote.name,
        color: remote.color,
        updatedAt: remote.updatedAt,
        deletedAt: remote.deletedAt ?? null,
        syncedAt: remote.syncedAt,
        version: remote.version,
      });
      return;
    }

    const synced = remote
      ? await context.supaObs.updateCategory(remote.id!, {
          clientId: local.clientId,
          name: local.name,
          color: local.color,
          updatedAt: local.updatedAt,
          deletedAt: null,
          version: local.version,
        })
      : await context.supaObs.createCategory(local);

    await context.dexieObs.updateCategory(local.id, {
      remoteId: synced.id ?? synced.remoteId,
      clientId: synced.clientId ?? local.clientId,
      updatedAt: synced.updatedAt,
      deletedAt: synced.deletedAt ?? null,
      syncedAt: new Date(),
      version: synced.version,
    });
  }

  private static async processObservationCategoryDelete(
    context: QueueContext,
    payload: ObservationCategoryDeletePayload
  ): Promise<void> {
    let remote = payload.clientId
      ? await context.supaObs.getCategoryByClientId(payload.clientId)
      : null;
    if (!remote && payload.remoteId != null) {
      remote = await context.supaObs.getCategoryById(payload.remoteId);
    }
    if (!remote && payload.name) {
      remote = await context.supaObs.getCategoryByName(payload.name);
    }
    if (remote?.id) {
      await context.supaObs.deleteCategory(remote.id);
    }
  }

  private static async processTradeTagsReplaceJob(
    context: QueueContext,
    job: SyncJob
  ): Promise<void> {
    const payload = (job.payload ?? {}) as TradeTagsReplacePayload;
    const supabaseTradeId = await this.resolveSupabaseTradeId(context, payload.tradeId);
    if (supabaseTradeId == null) {
      throw new Error("Could not resolve trade in cloud for trade-tag sync");
    }

    const supabaseTagIds: number[] = [];
    for (const localTagId of payload.tagIds) {
      const supabaseTagId = await this.resolveSupabaseTagId(context, localTagId);
      if (supabaseTagId != null) {
        supabaseTagIds.push(supabaseTagId);
      }
    }

    await context.supaTag.replaceForTrade(supabaseTradeId, supabaseTagIds);
  }

  private static async resolveSupabaseTradeId(
    context: QueueContext,
    localTradeId: number
  ): Promise<number | null> {
    const localTrade = await context.dexieTrade.getById(localTradeId);
    if (!localTrade?.accountId || !localTrade.ticketId) {
      return null;
    }

    const remoteTrade = await context.supaTrade.getByAccountAndTicket(
      localTrade.accountId,
      localTrade.ticketId
    );
    return remoteTrade?.id ?? null;
  }

  private static async resolveLocalTradeId(
    context: QueueContext,
    remoteTradeId: number
  ): Promise<number | null> {
    const byId = await context.dexieTrade.getById(remoteTradeId);
    if (byId?.id != null) {
      return byId.id;
    }

    const remoteTrade = await context.supaTrade.getById(remoteTradeId);
    if (!remoteTrade?.accountId || !remoteTrade.ticketId) {
      return null;
    }

    const localTrades = await context.dexieTrade.list({
      accountId: remoteTrade.accountId,
    });
    const match = localTrades.find((trade) => trade.ticketId === remoteTrade.ticketId);
    return match?.id ?? null;
  }

  private static async resolveSupabaseTagId(
    context: QueueContext,
    localTagId: number
  ): Promise<number | null> {
    const localTag = await context.dexieTag.getById(localTagId);
    if (!localTag?.id) return null;

    if (localTag.remoteId != null) {
      return localTag.remoteId;
    }

    let remote = localTag.clientId
      ? await context.supaTag.getByClientId(localTag.clientId)
      : null;
    if (!remote) {
      remote = await context.supaTag.getByNameAndCategory(
        localTag.name,
        localTag.category
      );
    }
    if (remote?.id) {
      await context.dexieTag.update(localTag.id, {
        remoteId: remote.id,
        clientId: remote.clientId ?? localTag.clientId,
      });
      return remote.id;
    }

    const created = await context.supaTag.create(localTag);
    await context.dexieTag.update(localTag.id, {
      remoteId: created.id,
      clientId: created.clientId ?? localTag.clientId,
    });
    return created.id ?? null;
  }

  private static async resolveSupabaseCategoryId(
    context: QueueContext,
    localCategoryId: number | null
  ): Promise<number | null> {
    if (localCategoryId == null) return null;

    const category = await context.dexieObs.getCategoryById(localCategoryId);
    if (!category?.id) return null;

    if (category.remoteId != null) {
      return category.remoteId;
    }

    let remote = category.clientId
      ? await context.supaObs.getCategoryByClientId(category.clientId)
      : null;
    if (!remote) {
      remote = await context.supaObs.getCategoryByName(category.name);
    }
    if (remote?.id) {
      await context.dexieObs.updateCategory(category.id, {
        remoteId: remote.id,
        clientId: remote.clientId ?? category.clientId,
      });
      return remote.id;
    }

    const created = await context.supaObs.createCategory(category);
    await context.dexieObs.updateCategory(category.id, {
      remoteId: created.id,
      clientId: created.clientId ?? category.clientId,
    });
    return created.id ?? null;
  }

  private static async resolveLocalCategoryId(
    context: QueueContext,
    remoteCategoryId: number | null
  ): Promise<number | null> {
    if (remoteCategoryId == null) return null;

    const byRemote = await context.dexieObs.getCategoryByRemoteId(remoteCategoryId);
    if (byRemote?.id != null) {
      return byRemote.id;
    }

    const legacy = await context.dexieObs.getCategoryById(remoteCategoryId);
    if (legacy?.id != null) {
      await context.dexieObs.updateCategory(legacy.id, { remoteId: remoteCategoryId });
      return legacy.id;
    }

    return null;
  }

  private static async createNoteConflictCopy(
    context: QueueContext,
    local: TradeNote
  ): Promise<void> {
    const now = new Date();
    const conflict = await context.dexieNote.create({
      tradeId: local.tradeId,
      clientId: createUuid(),
      content: `<p><strong>Conflict copy (${now.toLocaleString()})</strong></p>${local.content}`,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      syncedAt: null,
      version: 1,
      deviceId: getOrCreateDeviceId(),
    });
    if (conflict.id != null) {
      await this.queueNoteUpsert({ localId: conflict.id });
    }
  }

  private static async createObservationConflictCopy(
    context: QueueContext,
    local: Observation
  ): Promise<void> {
    const now = new Date();
    const conflict = await context.dexieObs.create({
      categoryId: local.categoryId ?? null,
      clientId: createUuid(),
      title: `Conflict Copy: ${local.title}`,
      content: local.content,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      syncedAt: null,
      version: 1,
      deviceId: getOrCreateDeviceId(),
    });
    if (conflict.id != null) {
      await this.queueObservationUpsert({ localId: conflict.id });
    }
  }
}
