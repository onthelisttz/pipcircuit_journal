import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ObservationCategory, Tag, Trade } from "../../../../src/domain/entities";
import { Direction, OrderType, TagCategory } from "../../../../src/domain/enums";

const hoisted = vi.hoisted(() => {
  const syncMetaStore = new Map<string, { key: string; lastSyncTime?: Date }>();
  const online = { value: true };
  return { syncMetaStore, online };
});

vi.mock("@infrastructure/db/dexie/database", () => ({
  db: {
    sync_meta: {
      get: vi.fn(async (key: string) => hoisted.syncMetaStore.get(key)),
      put: vi.fn(
        async (record: { key: string; lastSyncTime?: Date }) =>
          hoisted.syncMetaStore.set(record.key, record)
      ),
    },
  },
}));

vi.mock("@infrastructure/sync/utils", () => ({
  isOnline: () => hoisted.online.value,
}));

import {
  JournalDeltaSyncService,
  type JournalDeltaSyncDependencies,
  type JournalDeltaPullResult,
} from "../../../../src/infrastructure/sync/JournalDeltaSyncService";

function makeTrade(overrides: Partial<Trade> = {}): Trade {
  const timestamp = new Date("2026-01-01T00:00:00.000Z");
  return {
    id: overrides.id,
    accountId: overrides.accountId ?? "acc-1",
    ticketId: overrides.ticketId ?? "ticket-1",
    symbol: overrides.symbol ?? "EURUSD",
    direction: overrides.direction ?? Direction.Buy,
    orderType: overrides.orderType ?? OrderType.Market,
    openTime: overrides.openTime ?? timestamp,
    openPrice: overrides.openPrice ?? 1.1234,
    volume: overrides.volume ?? 1000,
    createdAt: overrides.createdAt ?? timestamp,
    updatedAt: overrides.updatedAt ?? timestamp,
    ...overrides,
  };
}

function makeTag(overrides: Partial<Tag> = {}): Tag {
  const timestamp = new Date("2026-01-01T00:00:00.000Z");
  return {
    id: overrides.id,
    remoteId: overrides.remoteId,
    clientId: overrides.clientId,
    name: overrides.name ?? "Focus",
    category: overrides.category ?? TagCategory.Custom,
    color: overrides.color ?? "#111111",
    createdAt: overrides.createdAt ?? timestamp,
    updatedAt: overrides.updatedAt ?? timestamp,
    deletedAt: overrides.deletedAt ?? null,
    ...overrides,
  };
}

function makeCategory(overrides: Partial<ObservationCategory> = {}): ObservationCategory {
  const timestamp = new Date("2026-01-01T00:00:00.000Z");
  return {
    id: overrides.id,
    remoteId: overrides.remoteId,
    clientId: overrides.clientId,
    name: overrides.name ?? "Pattern",
    color: overrides.color ?? "#222222",
    createdAt: overrides.createdAt ?? timestamp,
    updatedAt: overrides.updatedAt ?? timestamp,
    deletedAt: overrides.deletedAt ?? null,
    ...overrides,
  };
}

function makeDeps(
  overrides: Partial<JournalDeltaSyncDependencies> = {}
): JournalDeltaSyncDependencies {
  const base: JournalDeltaSyncDependencies = {
    dexieTrade: {
      getById: vi.fn(async () => null),
      list: vi.fn(async () => []),
    },
    dexieTag: {
      upsertFromRemote: vi.fn(async (tag) => tag),
      getByRemoteId: vi.fn(async () => null),
      getByIdIncludingDeleted: vi.fn(async () => null),
      update: vi.fn(async (id: number, updates: Partial<Tag>) => makeTag({ id, ...updates })),
      getByClientId: vi.fn(async () => null),
      deleteTradeTagByRemoteId: vi.fn(async () => undefined),
      deleteTradeTagByClientId: vi.fn(async () => undefined),
      upsertTradeTagFromRemote: vi.fn(async (tradeTag) => tradeTag),
    },
    dexieNote: {
      getByRemoteId: vi.fn(async () => null),
      getByClientId: vi.fn(async () => null),
      upsertFromRemote: vi.fn(async (note) => note),
    },
    dexieObs: {
      upsertCategoryFromRemote: vi.fn(async (category) => category),
      getCategoryByRemoteId: vi.fn(async () => null),
      getCategoryByIdIncludingDeleted: vi.fn(async () => null),
      updateCategory: vi.fn(
        async (id: number, updates: Partial<ObservationCategory>) =>
          makeCategory({ id, ...updates })
      ),
      getCategoryByClientId: vi.fn(async () => null),
      getByRemoteId: vi.fn(async () => null),
      getByClientId: vi.fn(async () => null),
      upsertFromRemote: vi.fn(async (obs) => obs),
    },
    supaTrade: {
      getById: vi.fn(async () => null),
    },
    supaTag: {
      listDeltasSince: vi.fn(async () => []),
      listTradeTagDeltasSince: vi.fn(async () => []),
      getById: vi.fn(async () => null),
    },
    supaNote: {
      listDeltasSince: vi.fn(async () => []),
    },
    supaObs: {
      listCategoryDeltasSince: vi.fn(async () => []),
      listDeltasSince: vi.fn(async () => []),
      getCategoryById: vi.fn(async () => null),
    },
    processQueue: vi.fn(async () => ({ processed: 1, failed: 0, deadLettered: 0 })),
  };

  return {
    ...base,
    ...overrides,
  };
}

describe("JournalDeltaSyncService", () => {
  beforeEach(() => {
    hoisted.syncMetaStore.clear();
    hoisted.online.value = true;
    vi.clearAllMocks();
  });

  it("persists per-table watermarks after successful delta pull", async () => {
    const t1 = new Date("2026-02-10T10:00:00.000Z");
    const t2 = new Date("2026-02-10T11:00:00.000Z");
    const t3 = new Date("2026-02-10T12:00:00.000Z");
    const t4 = new Date("2026-02-10T13:00:00.000Z");
    const t5 = new Date("2026-02-10T14:00:00.000Z");

    const base = makeDeps();
    const deps = makeDeps({
      dexieTrade: {
        getById: vi.fn(async (id: number) => makeTrade({ id })),
        list: vi.fn(async () => []),
      },
      dexieTag: {
        ...base.dexieTag,
        getByRemoteId: vi.fn(async (id: number) => makeTag({ id, remoteId: id })),
      },
      dexieObs: {
        ...base.dexieObs,
        getCategoryByRemoteId: vi.fn(async () =>
          makeCategory({ id: 5, remoteId: 200 })
        ),
      },
      supaTag: {
        listDeltasSince: vi.fn(async () => [
          {
            id: 10,
            remoteId: 10,
            clientId: "tag-c1",
            name: "Focus",
            category: TagCategory.Custom,
            color: "#111111",
            createdAt: t1,
            updatedAt: t1,
            deletedAt: null,
          },
        ]),
        listTradeTagDeltasSince: vi.fn(async () => [
          {
            id: 40,
            remoteId: 40,
            clientId: "tt-c1",
            tradeId: 300,
            tagId: 10,
            createdAt: t5,
            updatedAt: t5,
            deletedAt: null,
          },
        ]),
        getById: vi.fn(async () => null),
      },
      supaObs: {
        listCategoryDeltasSince: vi.fn(async () => [
          {
            id: 20,
            remoteId: 20,
            clientId: "cat-c1",
            name: "Pattern",
            color: "#222222",
            createdAt: t2,
            updatedAt: t2,
            deletedAt: null,
          },
        ]),
        listDeltasSince: vi.fn(async () => [
          {
            id: 30,
            remoteId: 30,
            clientId: "obs-c1",
            title: "Breakout",
            content: "<p>note</p>",
            categoryId: 200,
            createdAt: t3,
            updatedAt: t3,
            deletedAt: null,
          },
        ]),
        getCategoryById: vi.fn(async () => null),
      },
      supaNote: {
        listDeltasSince: vi.fn(async () => [
          {
            id: 35,
            remoteId: 35,
            clientId: "note-c1",
            tradeId: 300,
            content: "<p>note</p>",
            createdAt: t4,
            updatedAt: t4,
            deletedAt: null,
          },
        ]),
      },
    });

    const service = new JournalDeltaSyncService("user-1", deps);
    const result = await service.pullDeltas();

    expect(result.success).toBe(true);
    expect(result.tables.tags.applied).toBe(1);
    expect(result.tables.observation_categories.applied).toBe(1);
    expect(result.tables.observations.applied).toBe(1);
    expect(result.tables.trade_notes.applied).toBe(1);
    expect(result.tables.trade_tags.applied).toBe(1);

    expect(hoisted.syncMetaStore.get("journal:user-1:tags")?.lastSyncTime).toEqual(t1);
    expect(
      hoisted.syncMetaStore.get("journal:user-1:observation_categories")?.lastSyncTime
    ).toEqual(t2);
    expect(hoisted.syncMetaStore.get("journal:user-1:observations")?.lastSyncTime).toEqual(
      t3
    );
    expect(hoisted.syncMetaStore.get("journal:user-1:trade_notes")?.lastSyncTime).toEqual(
      t4
    );
    expect(hoisted.syncMetaStore.get("journal:user-1:trade_tags")?.lastSyncTime).toEqual(
      t5
    );
  });

  it("does not advance watermark when deltas are deferred", async () => {
    const existingWatermark = new Date("2026-02-09T10:00:00.000Z");
    hoisted.syncMetaStore.set("journal:user-2:trade_notes", {
      key: "journal:user-2:trade_notes",
      lastSyncTime: existingWatermark,
    });

    const deps = makeDeps({
      supaNote: {
        listDeltasSince: vi.fn(async () => [
          {
            id: 100,
            remoteId: 100,
            clientId: "note-x",
            tradeId: 9999,
            content: "<p>remote</p>",
            createdAt: new Date("2026-02-09T11:00:00.000Z"),
            updatedAt: new Date("2026-02-09T11:00:00.000Z"),
            deletedAt: null,
          },
        ]),
      },
      supaTrade: {
        getById: vi.fn(async () => null),
      },
    });

    const service = new JournalDeltaSyncService("user-2", deps);
    const result = await service.pullDeltas();

    expect(result.success).toBe(true);
    expect(result.tables.trade_notes.applied).toBe(0);
    expect(result.tables.trade_notes.deferred).toBe(1);
    expect(hoisted.syncMetaStore.get("journal:user-2:trade_notes")?.lastSyncTime).toEqual(
      existingWatermark
    );
  });

  it("runs pull -> queue -> pull in reconnect flow", async () => {
    const deps = makeDeps();
    const service = new JournalDeltaSyncService("user-3", deps);

    const firstPull: JournalDeltaPullResult = {
      success: true,
      tables: {
        tags: { pulled: 1, applied: 1, deferred: 0 },
        trade_notes: { pulled: 0, applied: 0, deferred: 0 },
        observations: { pulled: 0, applied: 0, deferred: 0 },
        observation_categories: { pulled: 0, applied: 0, deferred: 0 },
        trade_tags: { pulled: 0, applied: 0, deferred: 0 },
      },
    };
    const secondPull: JournalDeltaPullResult = {
      success: true,
      tables: {
        tags: { pulled: 0, applied: 0, deferred: 0 },
        trade_notes: { pulled: 0, applied: 0, deferred: 0 },
        observations: { pulled: 0, applied: 0, deferred: 0 },
        observation_categories: { pulled: 0, applied: 0, deferred: 0 },
        trade_tags: { pulled: 0, applied: 0, deferred: 0 },
      },
    };

    const pullSpy = vi
      .spyOn(service, "pullDeltas")
      .mockResolvedValueOnce(firstPull)
      .mockResolvedValueOnce(secondPull);

    const result = await service.runReconnectFlow();

    expect(result.success).toBe(true);
    expect(pullSpy).toHaveBeenCalledTimes(2);
    expect(deps.processQueue).toHaveBeenCalledTimes(1);

    const processQueueMock = deps.processQueue as unknown as {
      mock: { invocationCallOrder: number[] };
    };
    const pullOrder = pullSpy.mock.invocationCallOrder;
    const queueOrder = processQueueMock.mock.invocationCallOrder[0];
    expect(pullOrder[0]).toBeLessThan(queueOrder);
    expect(queueOrder).toBeLessThan(pullOrder[1]);
  });

  it("short-circuits reconnect flow when first pull fails", async () => {
    const deps = makeDeps();
    const service = new JournalDeltaSyncService("user-4", deps);

    vi.spyOn(service, "pullDeltas").mockResolvedValueOnce({
      success: false,
      error: "network",
      tables: {
        tags: { pulled: 0, applied: 0, deferred: 0 },
        trade_notes: { pulled: 0, applied: 0, deferred: 0 },
        observations: { pulled: 0, applied: 0, deferred: 0 },
        observation_categories: { pulled: 0, applied: 0, deferred: 0 },
        trade_tags: { pulled: 0, applied: 0, deferred: 0 },
      },
    });

    const result = await service.runReconnectFlow();

    expect(result.success).toBe(false);
    expect(result.error).toContain("network");
    expect(deps.processQueue).not.toHaveBeenCalled();
    expect(result.secondPull.tables.tags.pulled).toBe(0);
  });
});

