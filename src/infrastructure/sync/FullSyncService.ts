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
  ChartBar,
} from "@domain/entities";
import { SupabaseTradeRepository } from "@infrastructure/db/supabase/repositories/SupabaseTradeRepository";
import { SupabaseAccountRepository } from "@infrastructure/db/supabase/repositories/SupabaseAccountRepository";
import { SupabaseNoteRepository } from "@infrastructure/db/supabase/repositories/SupabaseNoteRepository";
import { SupabaseTagRepository } from "@infrastructure/db/supabase/repositories/SupabaseTagRepository";
import { SupabaseObservationRepository } from "@infrastructure/db/supabase/repositories/SupabaseObservationRepository";
import { SupabaseSettingsRepository } from "@infrastructure/db/supabase/repositories/SupabaseSettingsRepository";
import { SupabaseDailySummaryRepository } from "@infrastructure/db/supabase/repositories/SupabaseDailySummaryRepository";
import { SupabaseSymbolSyncProgressRepository } from "@infrastructure/db/supabase/repositories/SupabaseSymbolSyncProgressRepository";
import type { SettingRecord } from "@application/ports/repositories";

type SupabaseChartBarRow = {
  id: number;
  broker: string;
  symbol: string;
  timeframe: ChartBar["timeframe"];
  timestamp: number;
  open: number | string;
  high: number | string;
  low: number | string;
  close: number | string;
  volume: number | string;
  synced_at?: string | null;
};

export interface FullSyncResult {
  push: { success: boolean; error?: string };
  pull: { success: boolean; error?: string };
}

export type FullSyncProgressCallback = (step: string) => void;

export class FullSyncService {
  constructor(private readonly userId: string) {}

  /**
   * Push all data from Dexie to Supabase
   */
  async pushToSupabase(onProgress?: FullSyncProgressCallback): Promise<{ success: boolean; error?: string }> {
    try {
      const tradeRepo = new SupabaseTradeRepository(this.userId);
      const accountRepo = new SupabaseAccountRepository(this.userId);
      const noteRepo = new SupabaseNoteRepository(this.userId);
      const tagRepo = new SupabaseTagRepository(this.userId);
      const obsRepo = new SupabaseObservationRepository(this.userId);
      const settingsRepo = new SupabaseSettingsRepository(this.userId);
      const dailyRepo = new SupabaseDailySummaryRepository(this.userId);
      const progressRepo = new SupabaseSymbolSyncProgressRepository(this.userId);

      // 1. Accounts (no FKs)
      onProgress?.("Pushing accounts…");
      const accounts = await db.accounts.toArray();
      if (accounts.length > 0) {
        await accountRepo.bulkUpsert(accounts);
      }

      // 2. Trades (no FKs to our tables)
      onProgress?.("Pushing trades…");
      const trades = await db.trades.toArray();
      if (trades.length > 0) {
        await tradeRepo.bulkUpsert(trades);
      }

      // 3. Build trade ID mapping: (accountId, ticketId) -> supabase trade id
      const tradeMapping = new Map<string, number>();
      if (trades.length > 0) {
        const supabaseTrades = await tradeRepo.listAll();
        for (const t of supabaseTrades) {
          if (t.ticketId) {
            tradeMapping.set(`${t.accountId}::${t.ticketId}`, t.id!);
          }
        }
      }

      // 4. Observation categories (no FKs)
      onProgress?.("Pushing observation categories…");
      const obsCategories = await db.observation_categories.toArray();
      if (obsCategories.length > 0) {
        await obsRepo.bulkUpsertCategories(obsCategories);
      }

      // 5. Build category mapping: (name) -> supabase category id
      const catMapping = new Map<string, number>();
      const supabaseCats = await obsRepo.listAllCategories();
      for (const c of supabaseCats) {
        catMapping.set(c.name, c.id!);
      }

      // 6. Observations (categoryId FK - map Dexie category id to Supabase)
      onProgress?.("Pushing observations…");
      const dexieCatById = new Map<number, ObservationCategory>();
      for (const c of obsCategories) {
        if (c.id != null) dexieCatById.set(c.id, c);
      }
      const observations = await db.observations.toArray();
      const obsForSupabase: Observation[] = observations.map((o) => {
        const cat = o.categoryId != null ? dexieCatById.get(o.categoryId) : null;
        const supabaseCatId = cat ? catMapping.get(cat.name) : null;
        return { ...o, categoryId: supabaseCatId ?? undefined };
      });
      if (obsForSupabase.length > 0) {
        await obsRepo.bulkUpsertObservations(obsForSupabase);
      }

      // 7. Tags (no FKs)
      onProgress?.("Pushing tags…");
      const tags = await db.tags.toArray();
      if (tags.length > 0) {
        await tagRepo.bulkUpsertTags(tags);
      }

      // 8. Build tag mapping: (name, category) -> supabase tag id
      const tagMapping = new Map<string, number>();
      const supabaseTags = await tagRepo.listAll();
      for (const t of supabaseTags) {
        tagMapping.set(`${t.name}::${t.category}`, t.id!);
      }

      // 9. Trade tags (trade_id, tag_id - need both mappings)
      onProgress?.("Pushing trade tags…");
      // Clear existing trade_tags in Supabase and re-insert (full replace)
      const { data: existingTT } = await getSupabaseClient()
        .from("trade_tags")
        .select("id")
        .eq("user_id", this.userId);
      if (existingTT && existingTT.length > 0) {
        await getSupabaseClient()
          .from("trade_tags")
          .delete()
          .eq("user_id", this.userId);
      }
      const tradeTags = await db.trade_tags.toArray();
      const dexieTradesById = new Map<number, Trade>();
      for (const t of trades) {
        if (t.id != null) dexieTradesById.set(t.id, t);
      }
      const dexieTagsById = new Map<number, Tag>();
      for (const t of tags) {
        if (t.id != null) dexieTagsById.set(t.id, t);
      }
      const ttRows: { user_id: string; trade_id: number; tag_id: number }[] = [];
      for (const tt of tradeTags) {
        const trade = dexieTradesById.get(tt.tradeId);
        const tag = dexieTagsById.get(tt.tagId);
        if (!trade?.ticketId || !tag) continue;
        const supabaseTradeId = tradeMapping.get(`${trade.accountId}::${trade.ticketId}`);
        const supabaseTagId = tagMapping.get(`${tag.name}::${tag.category}`);
        if (supabaseTradeId != null && supabaseTagId != null) {
          ttRows.push({ user_id: this.userId, trade_id: supabaseTradeId, tag_id: supabaseTagId });
        }
      }
      if (ttRows.length > 0) {
        await getSupabaseClient().from("trade_tags").insert(ttRows);
      }

      // 10. Trade notes (trade_id - need mapping) - clear and re-insert
      onProgress?.("Pushing trade notes…");
      const { data: existingNotes } = await getSupabaseClient()
        .from("trade_notes")
        .select("id")
        .eq("user_id", this.userId);
      if (existingNotes && existingNotes.length > 0) {
        await getSupabaseClient()
          .from("trade_notes")
          .delete()
          .eq("user_id", this.userId);
      }
      const notes = await db.trade_notes.toArray();
      const notesForSupabase: { tradeId: number; content: string; createdAt: Date; updatedAt: Date }[] = [];
      for (const n of notes) {
        const trade = dexieTradesById.get(n.tradeId);
        if (!trade?.ticketId) continue;
        const supabaseTradeId = tradeMapping.get(`${trade.accountId}::${trade.ticketId}`);
        if (supabaseTradeId != null) {
          notesForSupabase.push({
            tradeId: supabaseTradeId,
            content: n.content,
            createdAt: n.createdAt instanceof Date ? n.createdAt : new Date(n.createdAt),
            updatedAt: n.updatedAt instanceof Date ? n.updatedAt : new Date(n.updatedAt),
          });
        }
      }
      if (notesForSupabase.length > 0) {
        await noteRepo.bulkUpsert(
          notesForSupabase.map((n) => ({
            tradeId: n.tradeId,
            content: n.content,
            createdAt: n.createdAt,
            updatedAt: n.updatedAt,
          }))
        );
      }

      // 11. Settings
      onProgress?.("Pushing settings…");
      const settings = await db.settings.toArray();
      for (const s of settings) {
        await settingsRepo.set(s);
      }

      // 12. Daily summaries
      onProgress?.("Pushing daily summaries…");
      const dailySummaries = await db.daily_summaries.toArray();
      if (dailySummaries.length > 0) {
        await dailyRepo.bulkUpsert(dailySummaries);
      }

      // 13. Symbol sync progress (chart bar sync status: completed/pending)
      onProgress?.("Pushing chart sync progress…");
      const syncProgressList = await db.symbol_sync_progress.toArray();
      for (const p of syncProgressList) {
        await progressRepo.upsert(p);
      }

      onProgress?.("Push complete.");
      return { success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[FullSync] Push failed:", err);
      return { success: false, error: msg };
    }
  }

  /**
   * Pull all data from Supabase to Dexie
   */
  async pullFromSupabase(onProgress?: FullSyncProgressCallback): Promise<{ success: boolean; error?: string }> {
    try {
      const tradeRepo = new SupabaseTradeRepository(this.userId);
      const accountRepo = new SupabaseAccountRepository(this.userId);
      const noteRepo = new SupabaseNoteRepository(this.userId);
      const tagRepo = new SupabaseTagRepository(this.userId);
      const obsRepo = new SupabaseObservationRepository(this.userId);
      const settingsRepo = new SupabaseSettingsRepository(this.userId);
      const dailyRepo = new SupabaseDailySummaryRepository(this.userId);
      const progressRepo = new SupabaseSymbolSyncProgressRepository(this.userId);

      // 1. Accounts
      onProgress?.("Pulling accounts…");
      const accounts = await accountRepo.listAll();
      await db.accounts.clear();
      if (accounts.length > 0) {
        await db.accounts.bulkAdd(accounts);
      }

      // 2. Trades (Supabase ids are used as Dexie keys when we bulkAdd with explicit id)
      onProgress?.("Pulling trades…");
      const trades = await tradeRepo.listAll();
      const supabaseTradeIdToDexieId = new Map<number, number>();
      await db.trades.clear();
      if (trades.length > 0) {
        await db.trades.bulkAdd(trades);
        trades.forEach((t) => {
          if (t.id != null) supabaseTradeIdToDexieId.set(t.id, t.id);
        });
      }

      // 3. Observation categories (Supabase ids used as Dexie keys)
      onProgress?.("Pulling observation categories…");
      const obsCategories = await obsRepo.listAllCategories();
      const supabaseCatIdToDexieId = new Map<number, number>();
      await db.observation_categories.clear();
      if (obsCategories.length > 0) {
        await db.observation_categories.bulkAdd(obsCategories);
        obsCategories.forEach((c) => {
          if (c.id != null) supabaseCatIdToDexieId.set(c.id, c.id);
        });
      }

      // 4. Observations (remap categoryId)
      onProgress?.("Pulling observations…");
      const observations = await obsRepo.listAll();
      const obsForDexie = observations.map((o) => {
        const dexieCatId = o.categoryId != null ? supabaseCatIdToDexieId.get(o.categoryId) : undefined;
        return { ...o, categoryId: dexieCatId ?? undefined };
      });
      await db.observations.clear();
      if (obsForDexie.length > 0) {
        await db.observations.bulkAdd(obsForDexie);
      }

      // 5. Tags (Supabase ids used as Dexie keys)
      onProgress?.("Pulling tags…");
      const tags = await tagRepo.listAll();
      const supabaseTagIdToDexieId = new Map<number, number>();
      await db.tags.clear();
      if (tags.length > 0) {
        await db.tags.bulkAdd(tags);
        tags.forEach((t) => {
          if (t.id != null) supabaseTagIdToDexieId.set(t.id, t.id);
        });
      }

      // 6. Trade tags (remap trade_id and tag_id)
      onProgress?.("Pulling trade tags…");
      const tradeTagsData = await tagRepo.listAllTradeTags();
      await db.trade_tags.clear();
      const tradeTagsForDexie: TradeTag[] = [];
      for (const tt of tradeTagsData) {
        const dexieTradeId = supabaseTradeIdToDexieId.get(tt.tradeId);
        const dexieTagId = supabaseTagIdToDexieId.get(tt.tagId);
        if (dexieTradeId != null && dexieTagId != null) {
          tradeTagsForDexie.push({
            remoteId: tt.id,
            tradeId: dexieTradeId,
            tagId: dexieTagId,
            createdAt: tt.createdAt ?? new Date(),
          });
        }
      }
      if (tradeTagsForDexie.length > 0) {
        await db.trade_tags.bulkAdd(tradeTagsForDexie);
      }

      // 7. Trade notes (remap trade_id)
      onProgress?.("Pulling trade notes…");
      const notes = await noteRepo.listAll();
      const notesForDexie: TradeNote[] = [];
      for (const n of notes) {
        const dexieTradeId = supabaseTradeIdToDexieId.get(n.tradeId);
        if (dexieTradeId != null) {
          notesForDexie.push({
            ...n,
            tradeId: dexieTradeId,
          });
        }
      }
      await db.trade_notes.clear();
      if (notesForDexie.length > 0) {
        await db.trade_notes.bulkAdd(notesForDexie);
      }

      // 8. Settings
      onProgress?.("Pulling settings…");
      const settings = await settingsRepo.list();
      await db.settings.clear();
      for (const s of settings) {
        await db.settings.put(s as SettingRecord);
      }

      // 9. Daily summaries
      onProgress?.("Pulling daily summaries…");
      const dailySummaries = await dailyRepo.listAll();
      await db.daily_summaries.clear();
      if (dailySummaries.length > 0) {
        await db.daily_summaries.bulkAdd(dailySummaries);
      }

      // 10. Symbol sync progress (chart bar sync status: completed/pending)
      onProgress?.("Pulling chart sync progress…");
      const syncProgressList = await progressRepo.getAll();
      await db.symbol_sync_progress.clear();
      if (syncProgressList.length > 0) {
        await db.symbol_sync_progress.bulkAdd(syncProgressList);
      }

      // 11. Chart bars:
      // - If local DB has no bars for any symbol, restore full history from Supabase.
      // - If local has some bars, restore missing head/tail windows per symbol.
      onProgress?.("Checking local chart bars…");
      const localBarCount = await db.chart_bars.count();

      if (syncProgressList.length > 0) {
        onProgress?.("Restoring chart bars from cloud…");
        const supabase = getSupabaseClient();
        const PAGE_SIZE = 5000;
        const totalSymbols = syncProgressList.length;
        let restoredSymbols = 0;

        // Helper to get local date range per symbol when we have any bars at all
        const hasAnyLocalBars = localBarCount > 0;
        // Lazy import of DexieChartBarRepository to avoid circular deps in type imports
        const { DexieChartBarRepository } = await import(
          "@infrastructure/db/dexie/repositories/DexieChartBarRepository"
        );
        const dexieChartRepo = new DexieChartBarRepository();

        for (const p of syncProgressList) {
          if (!p.broker || !p.symbol) continue;
          if (!p.firstBarDate || !p.lastBarDate) continue;

          // Determine which windows we need to restore for this symbol.
          const cloudFromTs = p.firstBarDate.getTime();
          const cloudToTs = p.lastBarDate.getTime();
          const restoreWindows: Array<{ from: number; to: number }> = [];

          if (!hasAnyLocalBars) {
            // Fresh device / cleared DB: restore full range for every symbol
            restoreWindows.push({ from: cloudFromTs, to: cloudToTs });
          } else {
            // Incremental per-symbol restore: look at local range in Dexie
            const localRange = await dexieChartRepo.getDateRange(
              p.broker,
              p.symbol,
              "M1"
            );

            if (!localRange.firstBarDate || !localRange.lastBarDate) {
              // No local bars for this symbol yet: restore full range for this symbol only
              restoreWindows.push({ from: cloudFromTs, to: cloudToTs });
            } else {
              const localFirstTs = localRange.firstBarDate.getTime();
              const localLastTs = localRange.lastBarDate.getTime();

              // Missing historical head
              if (localFirstTs > cloudFromTs) {
                restoreWindows.push({
                  from: cloudFromTs,
                  to: Math.min(localFirstTs - 1, cloudToTs),
                });
              }

              // Missing latest tail
              if (localLastTs < cloudToTs) {
                restoreWindows.push({
                  from: Math.max(localLastTs + 1, cloudFromTs),
                  to: cloudToTs,
                });
              }
            }
          }

          const validWindows = restoreWindows.filter((w) => w.from <= w.to);
          if (validWindows.length === 0) {
            continue;
          }

          // Get total bar count in Supabase for this symbol (for progress text only)
          let cloudTotalBars: number | null = null;
          try {
            const { count, error: countError } = await supabase
              .from("chart_bars")
              .select("*", { count: "exact", head: true })
              .eq("user_id", this.userId)
              .eq("broker", p.broker)
              .eq("symbol", p.symbol)
              .eq("timeframe", "M1");
            if (!countError) {
              cloudTotalBars = count ?? null;
            }
          } catch {
            // Non-fatal: just skip showing total-from-cloud in the progress text
          }

          let totalBars = 0;
          let firstTsSeen: number | null = null;
          let lastTsSeen: number | null = null;

          for (const window of validWindows) {
            let cursorTs = window.from;
            while (cursorTs <= window.to) {
              const { data, error } = await supabase
                .from("chart_bars")
                .select("*")
                .eq("user_id", this.userId)
                .eq("broker", p.broker)
                .eq("symbol", p.symbol)
                .eq("timeframe", "M1")
                .gte("timestamp", cursorTs)
                .lte("timestamp", window.to)
                .order("timestamp", { ascending: true })
                .limit(PAGE_SIZE);

              if (error) {
                throw new Error(
                  `Failed to restore chart bars for ${p.broker}:${p.symbol}: ${error.message}`
                );
              }

              if (!data || data.length === 0) {
                break;
              }

              const bars: ChartBar[] = (data as SupabaseChartBarRow[]).map((row) => ({
                id: row.id,
                broker: row.broker,
                symbol: row.symbol,
                timeframe: row.timeframe,
                timestamp: row.timestamp,
                open: Number(row.open),
                high: Number(row.high),
                low: Number(row.low),
                close: Number(row.close),
                volume: Number(row.volume),
                syncedAt: row.synced_at ? new Date(row.synced_at) : null,
              }));

              await db.chart_bars.bulkPut(bars);

              totalBars += bars.length;
              firstTsSeen = firstTsSeen ?? bars[0]?.timestamp ?? null;
              lastTsSeen = bars[bars.length - 1]?.timestamp ?? lastTsSeen;

              // Per-symbol progress text: downloaded vs total from cloud (if known)
              const downloadedText = totalBars.toLocaleString();
              const totalCloudText =
                cloudTotalBars != null ? `/${cloudTotalBars.toLocaleString()}` : "";
              onProgress?.(
                `Restoring chart bars from cloud… ${restoredSymbols}/${totalSymbols} symbols completed (${p.symbol}: ${downloadedText}${totalCloudText} bars)`
              );

              const lastTs = bars[bars.length - 1]?.timestamp;
              if (!lastTs || lastTs >= window.to) {
                break;
              }
              cursorTs = lastTs + 1;
            }
          }

          // If we restored any bars for this symbol, update its progress record
          if (totalBars > 0) {
            const inferredFirstBarDate = firstTsSeen ? new Date(firstTsSeen) : null;
            const inferredLastBarDate = lastTsSeen ? new Date(lastTsSeen) : null;
            const firstBarDate =
              p.firstBarDate && inferredFirstBarDate
                ? new Date(Math.min(p.firstBarDate.getTime(), inferredFirstBarDate.getTime()))
                : p.firstBarDate ?? inferredFirstBarDate;
            const lastBarDate =
              p.lastBarDate && inferredLastBarDate
                ? new Date(Math.max(p.lastBarDate.getTime(), inferredLastBarDate.getTime()))
                : p.lastBarDate ?? inferredLastBarDate;
            const localTotalBars = await dexieChartRepo.countBars(
              p.broker,
              p.symbol,
              "M1"
            );
            const resolvedTotalBars = cloudTotalBars ?? localTotalBars;

            await progressRepo.updateProgress(p.broker, p.symbol, {
              totalBars: resolvedTotalBars,
              status: "completed",
              firstBarDate: firstBarDate ?? undefined,
              lastBarDate: lastBarDate ?? undefined,
              lastSyncTime: new Date(),
              progressPercent: 100,
            });

            await db.symbol_sync_progress
              .where("[broker+symbol]")
              .equals([p.broker, p.symbol])
              .modify({
                totalBars: resolvedTotalBars,
                status: "completed",
                firstBarDate,
                lastBarDate,
                lastSyncTime: new Date(),
                progressPercent: 100,
              });

            restoredSymbols += 1;
          }
        }

        if (restoredSymbols > 0) {
          onProgress?.(
            `Restoring chart bars from cloud… ${restoredSymbols}/${totalSymbols} symbols completed`
          );
        }
      }

      onProgress?.("Pull complete.");
      return { success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[FullSync] Pull failed:", err);
      return { success: false, error: msg };
    }
  }

  /**
   * Resume/continue chart-bar restore from cloud without re-pulling all other entities.
   * Safe to run on app start after interruptions (e.g., page refresh).
   */
  async resumeChartBarsFromCloud(onProgress?: FullSyncProgressCallback): Promise<{
    success: boolean;
    restoredSymbols: number;
    totalSymbols: number;
    error?: string;
  }> {
    try {
      const progressRepo = new SupabaseSymbolSyncProgressRepository(this.userId);
      const syncProgressList = await progressRepo.getAll();
      const { restoredSymbols, totalSymbols } =
        await this.restoreChartBarsFromCloudInternal(syncProgressList, progressRepo, onProgress);
      return { success: true, restoredSymbols, totalSymbols };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[FullSync] Resume chart bars failed:", err);
      return { success: false, restoredSymbols: 0, totalSymbols: 0, error: msg };
    }
  }

  /**
   * Restore chart bars from cloud for a single broker+symbol pair.
   * Useful when local bars are partially missing and should be filled from Supabase
   * without calling external broker APIs.
   */
  async restoreChartBarsForSymbol(
    broker: string,
    symbol: string,
    onProgress?: FullSyncProgressCallback
  ): Promise<{
    success: boolean;
    restoredSymbols: number;
    totalSymbols: number;
    error?: string;
  }> {
    try {
      const progressRepo = new SupabaseSymbolSyncProgressRepository(this.userId);
      const syncProgressList = (await progressRepo.getAll()).filter(
        (p) => p.broker === broker && p.symbol === symbol
      );
      const { restoredSymbols, totalSymbols } = await this.restoreChartBarsFromCloudInternal(
        syncProgressList,
        progressRepo,
        onProgress
      );
      return { success: true, restoredSymbols, totalSymbols };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[FullSync] Restore chart bars for symbol failed:", err);
      return { success: false, restoredSymbols: 0, totalSymbols: 0, error: msg };
    }
  }

  private async restoreChartBarsFromCloudInternal(
    syncProgressList: Awaited<ReturnType<SupabaseSymbolSyncProgressRepository["getAll"]>>,
    progressRepo: SupabaseSymbolSyncProgressRepository,
    onProgress?: FullSyncProgressCallback
  ): Promise<{ restoredSymbols: number; totalSymbols: number }> {
    onProgress?.("Checking local chart bars...");
    const localBarCount = await db.chart_bars.count();

    if (syncProgressList.length === 0) {
      onProgress?.("Chart bars already up to date.");
      return { restoredSymbols: 0, totalSymbols: 0 };
    }

    onProgress?.("Restoring chart bars from cloud...");
    const supabase = getSupabaseClient();
    const PAGE_SIZE = 5000;
    const totalSymbols = syncProgressList.length;
    let restoredSymbols = 0;

    const hasAnyLocalBars = localBarCount > 0;
    const { DexieChartBarRepository } = await import(
      "@infrastructure/db/dexie/repositories/DexieChartBarRepository"
    );
    const dexieChartRepo = new DexieChartBarRepository();

    for (const p of syncProgressList) {
      if (!p.broker || !p.symbol) continue;
      if (!p.firstBarDate || !p.lastBarDate) continue;

      const cloudFromTs = p.firstBarDate.getTime();
      const cloudToTs = p.lastBarDate.getTime();
      const restoreWindows: Array<{ from: number; to: number }> = [];

      if (!hasAnyLocalBars) {
        restoreWindows.push({ from: cloudFromTs, to: cloudToTs });
      } else {
        const localRange = await dexieChartRepo.getDateRange(p.broker, p.symbol, "M1");
        if (!localRange.firstBarDate || !localRange.lastBarDate) {
          restoreWindows.push({ from: cloudFromTs, to: cloudToTs });
        } else {
          const localFirstTs = localRange.firstBarDate.getTime();
          const localLastTs = localRange.lastBarDate.getTime();

          if (localFirstTs > cloudFromTs) {
            restoreWindows.push({
              from: cloudFromTs,
              to: Math.min(localFirstTs - 1, cloudToTs),
            });
          }

          if (localLastTs < cloudToTs) {
            restoreWindows.push({
              from: Math.max(localLastTs + 1, cloudFromTs),
              to: cloudToTs,
            });
          }
        }
      }

      const validWindows = restoreWindows.filter((w) => w.from <= w.to);
      if (validWindows.length === 0) continue;

      let cloudTotalBars: number | null = null;
      try {
        const { count, error: countError } = await supabase
          .from("chart_bars")
          .select("*", { count: "exact", head: true })
          .eq("user_id", this.userId)
          .eq("broker", p.broker)
          .eq("symbol", p.symbol)
          .eq("timeframe", "M1");
        if (!countError) {
          cloudTotalBars = count ?? null;
        }
      } catch {
        // Non-fatal; progress message will show downloaded-only count.
      }

      let totalBars = 0;
      let firstTsSeen: number | null = null;
      let lastTsSeen: number | null = null;

      for (const window of validWindows) {
        let cursorTs = window.from;
        while (cursorTs <= window.to) {
          const { data, error } = await supabase
            .from("chart_bars")
            .select("*")
            .eq("user_id", this.userId)
            .eq("broker", p.broker)
            .eq("symbol", p.symbol)
            .eq("timeframe", "M1")
            .gte("timestamp", cursorTs)
            .lte("timestamp", window.to)
            .order("timestamp", { ascending: true })
            .limit(PAGE_SIZE);

          if (error) {
            throw new Error(
              `Failed to restore chart bars for ${p.broker}:${p.symbol}: ${error.message}`
            );
          }

          if (!data || data.length === 0) break;

          const bars: ChartBar[] = (data as SupabaseChartBarRow[]).map((row) => ({
            id: row.id,
            broker: row.broker,
            symbol: row.symbol,
            timeframe: row.timeframe,
            timestamp: row.timestamp,
            open: Number(row.open),
            high: Number(row.high),
            low: Number(row.low),
            close: Number(row.close),
            volume: Number(row.volume),
            syncedAt: row.synced_at ? new Date(row.synced_at) : null,
          }));

          await db.chart_bars.bulkPut(bars);

          totalBars += bars.length;
          firstTsSeen = firstTsSeen ?? bars[0]?.timestamp ?? null;
          lastTsSeen = bars[bars.length - 1]?.timestamp ?? lastTsSeen;

          const downloadedText = totalBars.toLocaleString();
          const totalCloudText = cloudTotalBars != null ? `/${cloudTotalBars.toLocaleString()}` : "";
          onProgress?.(
            `Restoring chart bars from cloud… ${restoredSymbols}/${totalSymbols} symbols completed (${p.symbol}: ${downloadedText}${totalCloudText} bars)`
          );

          const lastTs = bars[bars.length - 1]?.timestamp;
          if (!lastTs || lastTs >= window.to) break;
          cursorTs = lastTs + 1;
        }
      }

      if (totalBars > 0) {
        const inferredFirstBarDate = firstTsSeen ? new Date(firstTsSeen) : null;
        const inferredLastBarDate = lastTsSeen ? new Date(lastTsSeen) : null;
        const firstBarDate =
          p.firstBarDate && inferredFirstBarDate
            ? new Date(Math.min(p.firstBarDate.getTime(), inferredFirstBarDate.getTime()))
            : p.firstBarDate ?? inferredFirstBarDate;
        const lastBarDate =
          p.lastBarDate && inferredLastBarDate
            ? new Date(Math.max(p.lastBarDate.getTime(), inferredLastBarDate.getTime()))
            : p.lastBarDate ?? inferredLastBarDate;
        const localTotalBars = await dexieChartRepo.countBars(p.broker, p.symbol, "M1");
        const resolvedTotalBars = cloudTotalBars ?? localTotalBars;
        const now = new Date();

        await progressRepo.updateProgress(p.broker, p.symbol, {
          totalBars: resolvedTotalBars,
          status: "completed",
          firstBarDate: firstBarDate ?? undefined,
          lastBarDate: lastBarDate ?? undefined,
          lastSyncTime: now,
          progressPercent: 100,
        });

        const existingLocal = await db.symbol_sync_progress
          .where("[broker+symbol]")
          .equals([p.broker, p.symbol])
          .first();

        if (existingLocal?.id != null) {
          await db.symbol_sync_progress.update(existingLocal.id, {
            totalBars: resolvedTotalBars,
            status: "completed",
            firstBarDate,
            lastBarDate,
            lastSyncTime: now,
            progressPercent: 100,
            error: null,
          });
        } else {
          await db.symbol_sync_progress.put({
            broker: p.broker,
            symbol: p.symbol,
            totalBars: resolvedTotalBars,
            status: "completed",
            firstBarDate,
            lastBarDate,
            lastSyncTime: now,
            progressPercent: 100,
            error: null,
          });
        }

        restoredSymbols += 1;
      }
    }

    if (restoredSymbols > 0) {
      onProgress?.(
        `Restoring chart bars from cloud… ${restoredSymbols}/${totalSymbols} symbols completed`
      );
    } else {
      onProgress?.("Chart bars already up to date.");
    }

    return { restoredSymbols, totalSymbols };
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
      onProgress?.("Starting push…");
      const pushResult = await this.pushToSupabase(onProgress);
      push.success = pushResult.success;
      push.error = pushResult.error;
    }

    onProgress?.("Starting pull…");
    const pullResult = await this.pullFromSupabase(onProgress);
    pull.success = pullResult.success;
    pull.error = pullResult.error;

    onProgress?.(pull.success && push.success ? "Sync complete." : "Sync finished with errors.");
    return { push, pull };
  }
}
