/**
 * FullSyncService - Syncs all data between Dexie (local) and Supabase (cloud)
 *
 * Push: Dexie -> Supabase (with ID mapping for foreign keys)
 * Pull: Supabase -> Dexie (with ID mapping for foreign keys)
 */

import { getSupabaseClient } from "@infrastructure/db/supabase/client";
import { db } from "@infrastructure/db/dexie/database";
import type {
  Trade,
  TradeNote,
  Tag,
  TradeTag,
  Observation,
  ObservationCategory,
} from "@domain/entities";
import { SupabaseTradeRepository } from "@infrastructure/db/supabase/repositories/SupabaseTradeRepository";
import { SupabaseAccountRepository } from "@infrastructure/db/supabase/repositories/SupabaseAccountRepository";
import { SupabaseNoteRepository } from "@infrastructure/db/supabase/repositories/SupabaseNoteRepository";
import { SupabaseTagRepository } from "@infrastructure/db/supabase/repositories/SupabaseTagRepository";
import { SupabaseObservationRepository } from "@infrastructure/db/supabase/repositories/SupabaseObservationRepository";
import { SupabaseSettingsRepository } from "@infrastructure/db/supabase/repositories/SupabaseSettingsRepository";
import { SupabaseDailySummaryRepository } from "@infrastructure/db/supabase/repositories/SupabaseDailySummaryRepository";
import type { SettingRecord } from "@application/ports/repositories";

export interface FullSyncResult {
  push: { success: boolean; error?: string };
  pull: { success: boolean; error?: string };
}

export type FullSyncProgressCallback = (step: string) => void;

export class FullSyncService {
  constructor(private readonly userId: string) {}

  /**
   * Push all non-chart data from Dexie to Supabase.
   */
  async pushToSupabase(
    onProgress?: FullSyncProgressCallback
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const tradeRepo = new SupabaseTradeRepository(this.userId);
      const accountRepo = new SupabaseAccountRepository(this.userId);
      const noteRepo = new SupabaseNoteRepository(this.userId);
      const tagRepo = new SupabaseTagRepository(this.userId);
      const obsRepo = new SupabaseObservationRepository(this.userId);
      const settingsRepo = new SupabaseSettingsRepository(this.userId);
      const dailyRepo = new SupabaseDailySummaryRepository(this.userId);

      // 1. Accounts
      onProgress?.("Pushing accounts...");
      const accounts = await db.accounts.toArray();
      if (accounts.length > 0) {
        await accountRepo.bulkUpsert(accounts);
      }

      // 2. Trades
      onProgress?.("Pushing trades...");
      const trades = await db.trades.toArray();
      if (trades.length > 0) {
        await tradeRepo.bulkUpsert(trades);
      }

      // 3. Build trade ID mapping: (accountId, ticketId) -> Supabase trade id
      const tradeMapping = new Map<string, number>();
      if (trades.length > 0) {
        const supabaseTrades = await tradeRepo.listAll();
        for (const trade of supabaseTrades) {
          if (trade.ticketId) {
            tradeMapping.set(`${trade.accountId}::${trade.ticketId}`, trade.id!);
          }
        }
      }

      // 4. Observation categories
      onProgress?.("Pushing observation categories...");
      const obsCategories = await db.observation_categories.toArray();
      if (obsCategories.length > 0) {
        await obsRepo.bulkUpsertCategories(obsCategories);
      }

      // 5. Build category mapping: name -> Supabase category id
      const categoryMapping = new Map<string, number>();
      const supabaseCategories = await obsRepo.listAllCategories();
      for (const category of supabaseCategories) {
        categoryMapping.set(category.name, category.id!);
      }

      // 6. Observations (remap categoryId)
      onProgress?.("Pushing observations...");
      const dexieCategoriesById = new Map<number, ObservationCategory>();
      for (const category of obsCategories) {
        if (category.id != null) {
          dexieCategoriesById.set(category.id, category);
        }
      }
      const observations = await db.observations.toArray();
      const observationsForSupabase: Observation[] = observations.map((observation) => {
        const category =
          observation.categoryId != null
            ? dexieCategoriesById.get(observation.categoryId)
            : null;
        const supabaseCategoryId = category ? categoryMapping.get(category.name) : null;
        return { ...observation, categoryId: supabaseCategoryId ?? undefined };
      });
      if (observationsForSupabase.length > 0) {
        await obsRepo.bulkUpsertObservations(observationsForSupabase);
      }

      // 7. Tags
      onProgress?.("Pushing tags...");
      const tags = await db.tags.toArray();
      if (tags.length > 0) {
        await tagRepo.bulkUpsertTags(tags);
      }

      // 8. Build tag mapping: (name, category) -> Supabase tag id
      const tagMapping = new Map<string, number>();
      const supabaseTags = await tagRepo.listAll();
      for (const tag of supabaseTags) {
        tagMapping.set(`${tag.name}::${tag.category}`, tag.id!);
      }

      // 9. Trade tags (remap trade and tag IDs)
      onProgress?.("Pushing trade tags...");
      const { data: existingTradeTags } = await getSupabaseClient()
        .from("trade_tags")
        .select("id")
        .eq("user_id", this.userId);
      if (existingTradeTags && existingTradeTags.length > 0) {
        await getSupabaseClient().from("trade_tags").delete().eq("user_id", this.userId);
      }

      const tradeTags = await db.trade_tags.toArray();
      const dexieTradesById = new Map<number, Trade>();
      for (const trade of trades) {
        if (trade.id != null) {
          dexieTradesById.set(trade.id, trade);
        }
      }

      const dexieTagsById = new Map<number, Tag>();
      for (const tag of tags) {
        if (tag.id != null) {
          dexieTagsById.set(tag.id, tag);
        }
      }

      const tradeTagRows: { user_id: string; trade_id: number; tag_id: number }[] = [];
      for (const tradeTag of tradeTags) {
        const trade = dexieTradesById.get(tradeTag.tradeId);
        const tag = dexieTagsById.get(tradeTag.tagId);
        if (!trade?.ticketId || !tag) {
          continue;
        }

        const supabaseTradeId = tradeMapping.get(`${trade.accountId}::${trade.ticketId}`);
        const supabaseTagId = tagMapping.get(`${tag.name}::${tag.category}`);
        if (supabaseTradeId != null && supabaseTagId != null) {
          tradeTagRows.push({
            user_id: this.userId,
            trade_id: supabaseTradeId,
            tag_id: supabaseTagId,
          });
        }
      }

      if (tradeTagRows.length > 0) {
        await getSupabaseClient().from("trade_tags").insert(tradeTagRows);
      }

      // 10. Trade notes (remap trade_id)
      onProgress?.("Pushing trade notes...");
      const { data: existingNotes } = await getSupabaseClient()
        .from("trade_notes")
        .select("id")
        .eq("user_id", this.userId);
      if (existingNotes && existingNotes.length > 0) {
        await getSupabaseClient().from("trade_notes").delete().eq("user_id", this.userId);
      }

      const notes = await db.trade_notes.toArray();
      const notesForSupabase: {
        tradeId: number;
        content: string;
        createdAt: Date;
        updatedAt: Date;
      }[] = [];
      for (const note of notes) {
        const trade = dexieTradesById.get(note.tradeId);
        if (!trade?.ticketId) {
          continue;
        }

        const supabaseTradeId = tradeMapping.get(`${trade.accountId}::${trade.ticketId}`);
        if (supabaseTradeId != null) {
          notesForSupabase.push({
            tradeId: supabaseTradeId,
            content: note.content,
            createdAt:
              note.createdAt instanceof Date ? note.createdAt : new Date(note.createdAt),
            updatedAt:
              note.updatedAt instanceof Date ? note.updatedAt : new Date(note.updatedAt),
          });
        }
      }

      if (notesForSupabase.length > 0) {
        await noteRepo.bulkUpsert(
          notesForSupabase.map((note) => ({
            tradeId: note.tradeId,
            content: note.content,
            createdAt: note.createdAt,
            updatedAt: note.updatedAt,
          }))
        );
      }

      // 11. Settings
      onProgress?.("Pushing settings...");
      const settings = await db.settings.toArray();
      for (const setting of settings) {
        await settingsRepo.set(setting);
      }

      // 12. Daily summaries
      onProgress?.("Pushing daily summaries...");
      const dailySummaries = await db.daily_summaries.toArray();
      if (dailySummaries.length > 0) {
        await dailyRepo.bulkUpsert(dailySummaries);
      }

      onProgress?.("Push complete.");
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[FullSync] Push failed:", error);
      return { success: false, error: message };
    }
  }

  /**
   * Pull all non-chart data from Supabase to Dexie.
   */
  async pullFromSupabase(
    onProgress?: FullSyncProgressCallback
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const tradeRepo = new SupabaseTradeRepository(this.userId);
      const accountRepo = new SupabaseAccountRepository(this.userId);
      const noteRepo = new SupabaseNoteRepository(this.userId);
      const tagRepo = new SupabaseTagRepository(this.userId);
      const obsRepo = new SupabaseObservationRepository(this.userId);
      const settingsRepo = new SupabaseSettingsRepository(this.userId);
      const dailyRepo = new SupabaseDailySummaryRepository(this.userId);

      // 1. Accounts
      onProgress?.("Pulling accounts...");
      const accounts = await accountRepo.listAll();
      await db.accounts.clear();
      if (accounts.length > 0) {
        await db.accounts.bulkAdd(accounts);
      }

      // 2. Trades
      onProgress?.("Pulling trades...");
      const trades = await tradeRepo.listAll();
      const supabaseTradeIdToDexieId = new Map<number, number>();
      await db.trades.clear();
      if (trades.length > 0) {
        await db.trades.bulkAdd(trades);
        trades.forEach((trade) => {
          if (trade.id != null) {
            supabaseTradeIdToDexieId.set(trade.id, trade.id);
          }
        });
      }

      // 3. Observation categories
      onProgress?.("Pulling observation categories...");
      const observationCategories = await obsRepo.listAllCategories();
      const supabaseCategoryIdToDexieId = new Map<number, number>();
      await db.observation_categories.clear();
      if (observationCategories.length > 0) {
        await db.observation_categories.bulkAdd(observationCategories);
        observationCategories.forEach((category) => {
          if (category.id != null) {
            supabaseCategoryIdToDexieId.set(category.id, category.id);
          }
        });
      }

      // 4. Observations (remap categoryId)
      onProgress?.("Pulling observations...");
      const observations = await obsRepo.listAll();
      const observationsForDexie = observations.map((observation) => {
        const dexieCategoryId =
          observation.categoryId != null
            ? supabaseCategoryIdToDexieId.get(observation.categoryId)
            : undefined;
        return { ...observation, categoryId: dexieCategoryId ?? undefined };
      });
      await db.observations.clear();
      if (observationsForDexie.length > 0) {
        await db.observations.bulkAdd(observationsForDexie);
      }

      // 5. Tags
      onProgress?.("Pulling tags...");
      const tags = await tagRepo.listAll();
      const supabaseTagIdToDexieId = new Map<number, number>();
      await db.tags.clear();
      if (tags.length > 0) {
        await db.tags.bulkAdd(tags);
        tags.forEach((tag) => {
          if (tag.id != null) {
            supabaseTagIdToDexieId.set(tag.id, tag.id);
          }
        });
      }

      // 6. Trade tags (remap trade_id and tag_id)
      onProgress?.("Pulling trade tags...");
      const tradeTagsData = await tagRepo.listAllTradeTags();
      await db.trade_tags.clear();
      const tradeTagsForDexie: TradeTag[] = [];
      for (const tradeTag of tradeTagsData) {
        const dexieTradeId = supabaseTradeIdToDexieId.get(tradeTag.tradeId);
        const dexieTagId = supabaseTagIdToDexieId.get(tradeTag.tagId);
        if (dexieTradeId != null && dexieTagId != null) {
          tradeTagsForDexie.push({
            remoteId: tradeTag.id,
            tradeId: dexieTradeId,
            tagId: dexieTagId,
            createdAt: tradeTag.createdAt ?? new Date(),
          });
        }
      }
      if (tradeTagsForDexie.length > 0) {
        await db.trade_tags.bulkAdd(tradeTagsForDexie);
      }

      // 7. Trade notes (remap trade_id)
      onProgress?.("Pulling trade notes...");
      const notes = await noteRepo.listAll();
      const notesForDexie: TradeNote[] = [];
      for (const note of notes) {
        const dexieTradeId = supabaseTradeIdToDexieId.get(note.tradeId);
        if (dexieTradeId != null) {
          notesForDexie.push({
            ...note,
            tradeId: dexieTradeId,
          });
        }
      }
      await db.trade_notes.clear();
      if (notesForDexie.length > 0) {
        await db.trade_notes.bulkAdd(notesForDexie);
      }

      // 8. Settings
      onProgress?.("Pulling settings...");
      const settings = await settingsRepo.list();
      await db.settings.clear();
      for (const setting of settings) {
        await db.settings.put(setting as SettingRecord);
      }

      // 9. Daily summaries
      onProgress?.("Pulling daily summaries...");
      const dailySummaries = await dailyRepo.listAll();
      await db.daily_summaries.clear();
      if (dailySummaries.length > 0) {
        await db.daily_summaries.bulkAdd(dailySummaries);
      }

      onProgress?.("Pull complete.");
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[FullSync] Pull failed:", error);
      return { success: false, error: message };
    }
  }

  /**
   * Full sync: push local to cloud, then pull (for conflict resolution pull wins)
   * Or just pull when Dexie is empty (new device).
   * Use onProgress to show step-by-step status in the UI.
   */
  async sync(options?: {
    pushFirst?: boolean;
    pullOnly?: boolean;
    onProgress?: FullSyncProgressCallback;
  }): Promise<FullSyncResult> {
    const push = { success: true as boolean, error: undefined as string | undefined };
    const pull = { success: true as boolean, error: undefined as string | undefined };
    const onProgress = options?.onProgress;

    if (!options?.pullOnly && options?.pushFirst !== false) {
      onProgress?.("Starting push...");
      const pushResult = await this.pushToSupabase(onProgress);
      push.success = pushResult.success;
      push.error = pushResult.error;
    }

    onProgress?.("Starting pull...");
    const pullResult = await this.pullFromSupabase(onProgress);
    pull.success = pullResult.success;
    pull.error = pullResult.error;

    onProgress?.(pull.success && push.success ? "Sync complete." : "Sync finished with errors.");
    return { push, pull };
  }
}
