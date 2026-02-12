/**
 * Factory for creating dual (Dexie + Supabase) repositories when user is logged in.
 * Used by hooks to get real-time sync to cloud.
 */

import { DexieTradeRepository } from "@infrastructure/db/dexie/repositories";
import { DexieAccountRepository } from "@infrastructure/db/dexie/repositories";
import { DexieNoteRepository } from "@infrastructure/db/dexie/repositories";
import { DexieTagRepository } from "@infrastructure/db/dexie/repositories";
import { DexieObservationRepository } from "@infrastructure/db/dexie/repositories";
import { DexieSettingsRepository } from "@infrastructure/db/dexie/repositories";
import { DexieDailySummaryRepository } from "@infrastructure/db/dexie/repositories";
import { SupabaseTradeRepository } from "@infrastructure/db/supabase/repositories";
import { SupabaseAccountRepository } from "@infrastructure/db/supabase/repositories";
import { SupabaseNoteRepository } from "@infrastructure/db/supabase/repositories";
import { SupabaseTagRepository } from "@infrastructure/db/supabase/repositories";
import { SupabaseObservationRepository } from "@infrastructure/db/supabase/repositories";
import { SupabaseSettingsRepository } from "@infrastructure/db/supabase/repositories";
import { SupabaseDailySummaryRepository } from "@infrastructure/db/supabase/repositories";
import { DualTradeRepository } from "./DualTradeRepository";
import { DualAccountRepository } from "./DualAccountRepository";
import { DualNoteRepository } from "./DualNoteRepository";
import { DualTagRepository } from "./DualTagRepository";
import { DualObservationRepository } from "./DualObservationRepository";
import { DualSettingsRepository } from "./DualSettingsRepository";
import { DualDailySummaryRepository } from "./DualDailySummaryRepository";
import type { ITradeRepository, IAccountRepository, INoteRepository, ITagRepository, IObservationRepository, ISettingsRepository, IDailySummaryRepository } from "@application/ports/repositories";

export function createTradeRepository(userId: string | undefined): ITradeRepository {
  const dexie = new DexieTradeRepository();
  if (!userId) return dexie;
  return new DualTradeRepository(dexie, new SupabaseTradeRepository(userId));
}

export function createAccountRepository(userId: string | undefined): IAccountRepository {
  const dexie = new DexieAccountRepository();
  if (!userId) return dexie;
  return new DualAccountRepository(dexie, new SupabaseAccountRepository(userId));
}

export function createNoteRepository(userId: string | undefined): INoteRepository {
  const dexie = new DexieNoteRepository();
  if (!userId) return dexie;
  const supabaseTrade = new SupabaseTradeRepository(userId);
  const dexieTrade = new DexieTradeRepository();
  const resolveTradeId = async (dexieTradeId: number): Promise<number | null> => {
    const trade = await dexieTrade.getById(dexieTradeId);
    if (!trade?.accountId || !trade?.ticketId) return null;
    const supabaseTradeObj = await supabaseTrade.getByAccountAndTicket(trade.accountId, trade.ticketId);
    return supabaseTradeObj?.id ?? null;
  };
  return new DualNoteRepository(dexie, new SupabaseNoteRepository(userId), resolveTradeId);
}

export function createTagRepository(userId: string | undefined): ITagRepository {
  const dexie = new DexieTagRepository();
  if (!userId) return dexie;
  const supabaseTrade = new SupabaseTradeRepository(userId);
  const supabaseTag = new SupabaseTagRepository(userId);
  const dexieTrade = new DexieTradeRepository();
  const dexieTag = new DexieTagRepository();
  const resolveTradeId = async (dexieTradeId: number): Promise<number | null> => {
    const trade = await dexieTrade.getById(dexieTradeId);
    if (!trade?.accountId || !trade?.ticketId) return null;
    const supabaseTradeObj = await supabaseTrade.getByAccountAndTicket(trade.accountId, trade.ticketId);
    return supabaseTradeObj?.id ?? null;
  };
  const resolveTagId = async (dexieTagId: number): Promise<number | null> => {
    const tag = await dexieTag.getById(dexieTagId);
    if (!tag) return null;
    if (tag.remoteId != null) return tag.remoteId;
    const supabaseTagObj = tag.clientId
      ? await supabaseTag.getByClientId(tag.clientId)
      : await supabaseTag.getByNameAndCategory(tag.name, tag.category);
    return supabaseTagObj?.id ?? null;
  };
  return new DualTagRepository(dexie, new SupabaseTagRepository(userId), resolveTradeId, resolveTagId);
}

export function createObservationRepository(userId: string | undefined): IObservationRepository {
  const dexie = new DexieObservationRepository();
  if (!userId) return dexie;
  const supabaseObs = new SupabaseObservationRepository(userId);
  const dexieObs = new DexieObservationRepository();
  const resolveCategoryId = async (dexieCatId: number): Promise<number | null> => {
    const categories = await dexieObs.listCategories();
    const cat = categories.find((c) => c.id === dexieCatId);
    if (!cat) return null;
    if (cat.remoteId != null) return cat.remoteId;
    const supabaseCat = cat.clientId
      ? await supabaseObs.getCategoryByClientId(cat.clientId)
      : await supabaseObs.getCategoryByName(cat.name);
    return supabaseCat?.id ?? null;
  };
  return new DualObservationRepository(dexie, new SupabaseObservationRepository(userId), resolveCategoryId);
}

export function createSettingsRepository(userId: string | undefined): ISettingsRepository {
  const dexie = new DexieSettingsRepository();
  if (!userId) return dexie;
  return new DualSettingsRepository(dexie, new SupabaseSettingsRepository(userId));
}

export function createDailySummaryRepository(userId: string | undefined): IDailySummaryRepository {
  const dexie = new DexieDailySummaryRepository();
  if (!userId) return dexie;
  return new DualDailySummaryRepository(dexie, new SupabaseDailySummaryRepository(userId));
}
