import { beforeEach, describe, expect, it, vi } from "vitest";

import { SyncAction, SyncStatus } from "../../../../src/domain/enums";
import * as syncUtils from "../../../../src/infrastructure/sync/utils";

const hoisted = vi.hoisted(() => {
  let nextId = 1;
  const jobs: Array<Record<string, unknown>> = [];

  const reset = () => {
    jobs.length = 0;
    nextId = 1;
  };

  const addJob = (job: Record<string, unknown>) => {
    const id = (job.id as number | undefined) ?? nextId++;
    jobs.push({ ...job, id });
    return id;
  };

  return { jobs, reset, addJob };
});

vi.mock("@infrastructure/db/dexie/database", () => ({
  db: {
    sync_queue: {
      filter: (predicate: (job: Record<string, unknown>) => boolean) => ({
        toArray: async () => hoisted.jobs.filter(predicate),
        first: async () => hoisted.jobs.find(predicate),
      }),
      where: (field: string) => ({
        equals: (value: unknown) => ({
          toArray: async () =>
            hoisted.jobs.filter((job) => (job as Record<string, unknown>)[field] === value),
        }),
      }),
      update: async (id: number, updates: Record<string, unknown>) => {
        const index = hoisted.jobs.findIndex((job) => job.id === id);
        if (index < 0) return 0;
        hoisted.jobs[index] = { ...hoisted.jobs[index], ...updates };
        return 1;
      },
      delete: async (id: number) => {
        const index = hoisted.jobs.findIndex((job) => job.id === id);
        if (index >= 0) {
          hoisted.jobs.splice(index, 1);
        }
      },
      add: async (job: Record<string, unknown>) => hoisted.addJob(job),
    },
  },
}));

import { EntitySyncQueue } from "../../../../src/infrastructure/sync/EntitySyncQueue";

type QueueInternals = {
  createContext: (userId: string) => unknown;
  processJob: (context: unknown, job: unknown) => Promise<void>;
  queueNoteUpsert: (payload: { localId: number }) => Promise<void>;
  createNoteConflictCopy: (
    context: {
      dexieNote: {
        create: (input: unknown) => Promise<{ id?: number }>;
      };
    },
    local: {
      tradeId: number;
      content: string;
      createdAt: Date;
      updatedAt: Date;
    }
  ) => Promise<void>;
};

const queueInternals = EntitySyncQueue as unknown as QueueInternals;

describe("EntitySyncQueue", () => {
  beforeEach(() => {
    hoisted.reset();
    vi.restoreAllMocks();
    vi.spyOn(syncUtils, "isOnline").mockReturnValue(true);
  });

  it("retries failed jobs with backoff before dead-lettering", async () => {
    hoisted.addJob({
      action: SyncAction.Update,
      table: "tags",
      entityId: "tag:1",
      payload: { localId: 1 },
      timestamp: new Date(),
      retryCount: 0,
      status: SyncStatus.Pending,
    });

    vi.spyOn(queueInternals, "createContext").mockReturnValue({});
    vi.spyOn(queueInternals, "processJob").mockRejectedValue(new Error("boom"));

    const result = await EntitySyncQueue.processQueue("user-1");

    expect(result).toEqual({ processed: 0, failed: 1, deadLettered: 0 });
    expect(hoisted.jobs).toHaveLength(1);
    expect(hoisted.jobs[0]?.status).toBe(SyncStatus.Pending);
    expect(hoisted.jobs[0]?.retryCount).toBe(1);
    expect(hoisted.jobs[0]?.lastError).toBe("boom");
    expect(hoisted.jobs[0]?.nextRetryAt).toBeInstanceOf(Date);
    expect(hoisted.jobs[0]?.deadLetterAt ?? null).toBeNull();
  });

  it("dead-letters jobs at max retries", async () => {
    hoisted.addJob({
      action: SyncAction.Update,
      table: "trade_notes",
      entityId: "note:1",
      payload: { localId: 1 },
      timestamp: new Date(),
      retryCount: 7,
      status: SyncStatus.Pending,
    });

    vi.spyOn(queueInternals, "createContext").mockReturnValue({});
    vi.spyOn(queueInternals, "processJob").mockRejectedValue(
      new Error("still failing")
    );

    const result = await EntitySyncQueue.processQueue("user-1");

    expect(result).toEqual({ processed: 0, failed: 0, deadLettered: 1 });
    expect(hoisted.jobs).toHaveLength(1);
    expect(hoisted.jobs[0]?.status).toBe(SyncStatus.Error);
    expect(hoisted.jobs[0]?.retryCount).toBe(8);
    expect(hoisted.jobs[0]?.nextRetryAt ?? null).toBeNull();
    expect(hoisted.jobs[0]?.deadLetterAt).toBeInstanceOf(Date);
  });

  it("resets failed non-bar jobs back to pending", async () => {
    const tagJobId = hoisted.addJob({
      action: SyncAction.Update,
      table: "tags",
      entityId: "tag:1",
      payload: { localId: 1 },
      timestamp: new Date(),
      retryCount: 8,
      status: SyncStatus.Error,
      lastError: "failed",
    });
    hoisted.addJob({
      action: SyncAction.Update,
      table: "chart_bars",
      entityId: "bar:1",
      payload: { id: 1 },
      timestamp: new Date(),
      retryCount: 5,
      status: SyncStatus.Error,
      lastError: "bar failed",
    });

    const retried = await EntitySyncQueue.retryFailed();

    const tagJob = hoisted.jobs.find((job) => job.id === tagJobId);
    const barJob = hoisted.jobs.find((job) => job.table === "chart_bars");

    expect(retried).toBe(1);
    expect(tagJob?.status).toBe(SyncStatus.Pending);
    expect(tagJob?.retryCount).toBe(0);
    expect(tagJob?.lastError ?? null).toBeNull();
    expect(barJob?.status).toBe(SyncStatus.Error);
  });

  it("reports queue stats excluding chart bar jobs", async () => {
    hoisted.addJob({
      action: SyncAction.Update,
      table: "tags",
      entityId: "tag:1",
      payload: { localId: 1 },
      timestamp: new Date(),
      retryCount: 0,
      status: SyncStatus.Pending,
    });
    hoisted.addJob({
      action: SyncAction.Update,
      table: "trade_notes",
      entityId: "note:1",
      payload: { localId: 1 },
      timestamp: new Date(),
      retryCount: 2,
      status: SyncStatus.Pending,
    });
    hoisted.addJob({
      action: SyncAction.Update,
      table: "observations",
      entityId: "obs:1",
      payload: { localId: 1 },
      timestamp: new Date(),
      retryCount: 0,
      status: SyncStatus.Syncing,
    });
    hoisted.addJob({
      action: SyncAction.Update,
      table: "observations",
      entityId: "obs:2",
      payload: { localId: 2 },
      timestamp: new Date(),
      retryCount: 4,
      status: SyncStatus.Error,
    });
    hoisted.addJob({
      action: SyncAction.Update,
      table: "chart_bars",
      entityId: "bar:1",
      payload: { id: 1 },
      timestamp: new Date(),
      retryCount: 4,
      status: SyncStatus.Error,
    });

    const stats = await EntitySyncQueue.getStats();

    expect(stats).toEqual({
      pending: 1,
      retrying: 1,
      syncing: 1,
      failed: 1,
    });
  });

  it("creates and queues note conflict copies", async () => {
    const queueSpy = vi
      .spyOn(queueInternals, "queueNoteUpsert")
      .mockResolvedValue(undefined);
    const createSpy = vi.fn(async (input: unknown) => {
      void input;
      return { id: 77 };
    });

    await queueInternals.createNoteConflictCopy(
      {
        dexieNote: {
          create: createSpy,
        },
      },
      {
        tradeId: 10,
        content: "<p>local change</p>",
        createdAt: new Date("2026-02-01T00:00:00.000Z"),
        updatedAt: new Date("2026-02-01T00:00:00.000Z"),
      }
    );

    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(queueSpy).toHaveBeenCalledWith({ localId: 77 });
    const payload = createSpy.mock.calls[0]?.[0] as unknown as { content?: string };
    expect(payload.content).toContain("Conflict copy");
    expect(payload.content).toContain("<p>local change</p>");
  });
});
