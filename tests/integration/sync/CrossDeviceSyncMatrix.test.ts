import { describe, expect, it } from "vitest";

type NoteRecord = {
  clientId: string;
  content: string;
  updatedAt: Date;
  deletedAt: Date | null;
  version: number;
  deviceId: string;
  syncedAt: Date | null;
};

function cloneNote(note: NoteRecord): NoteRecord {
  return {
    ...note,
    updatedAt: new Date(note.updatedAt),
    deletedAt: note.deletedAt ? new Date(note.deletedAt) : null,
    syncedAt: note.syncedAt ? new Date(note.syncedAt) : null,
  };
}

function noteEventTime(note: NoteRecord): Date {
  return note.deletedAt ?? note.updatedAt;
}

function isIncomingNewer(incoming: NoteRecord, existing: NoteRecord): boolean {
  const incomingTime = noteEventTime(incoming).getTime();
  const existingTime = noteEventTime(existing).getTime();
  if (incomingTime > existingTime) return true;
  if (incomingTime < existingTime) return false;
  return (incoming.version ?? 0) > (existing.version ?? 0);
}

class CloudSimulator {
  private notes = new Map<string, NoteRecord>();
  private listeners = new Map<string, (note: NoteRecord) => void>();

  seed(note: NoteRecord): void {
    this.notes.set(note.clientId, cloneNote(note));
  }

  subscribe(deviceId: string, listener: (note: NoteRecord) => void): void {
    this.listeners.set(deviceId, listener);
  }

  applyUpsert(sourceDeviceId: string, note: NoteRecord): boolean {
    const existing = this.notes.get(note.clientId);
    if (existing && !isIncomingNewer(note, existing)) {
      return false;
    }

    const eventTime = noteEventTime(note);
    const persisted = cloneNote(note);
    persisted.syncedAt = new Date(eventTime);
    this.notes.set(note.clientId, persisted);

    for (const [deviceId, listener] of this.listeners.entries()) {
      if (deviceId === sourceDeviceId) continue;
      listener(cloneNote(persisted));
    }

    return true;
  }

  snapshotSince(since?: Date): NoteRecord[] {
    return [...this.notes.values()]
      .filter((row) => (since ? noteEventTime(row).getTime() > since.getTime() : true))
      .sort((a, b) => noteEventTime(a).getTime() - noteEventTime(b).getTime())
      .map(cloneNote);
  }

  get(clientId: string): NoteRecord | null {
    const row = this.notes.get(clientId);
    return row ? cloneNote(row) : null;
  }
}

class DeviceSimulator {
  private local = new Map<string, NoteRecord>();
  private outbox = new Map<string, NoteRecord>();
  private watermark?: Date;
  private conflictCounter = 0;
  private online = true;

  constructor(
    private readonly deviceId: string,
    private readonly cloud: CloudSimulator
  ) {
    this.cloud.subscribe(this.deviceId, (row) => {
      if (!this.online) return;
      this.applyRemote(row);
    });
  }

  setOnline(value: boolean): void {
    this.online = value;
  }

  edit(clientId: string, content: string, updatedAt: Date): void {
    const existing = this.local.get(clientId);
    const next: NoteRecord = {
      clientId,
      content,
      updatedAt,
      deletedAt: null,
      version: (existing?.version ?? 0) + 1,
      deviceId: this.deviceId,
      syncedAt: null,
    };
    this.local.set(clientId, cloneNote(next));

    if (this.online) {
      this.pushToCloud(next);
      return;
    }

    this.outbox.set(clientId, cloneNote(next));
  }

  delete(clientId: string, deletedAt: Date): void {
    const existing = this.local.get(clientId);
    const next: NoteRecord = {
      clientId,
      content: existing?.content ?? "",
      updatedAt: deletedAt,
      deletedAt,
      version: (existing?.version ?? 0) + 1,
      deviceId: this.deviceId,
      syncedAt: null,
    };
    this.local.set(clientId, cloneNote(next));

    if (this.online) {
      this.pushToCloud(next);
      return;
    }

    this.outbox.set(clientId, cloneNote(next));
  }

  runReconnectFlow(): void {
    if (!this.online) return;
    this.pullDeltas();
    this.replayOutbox();
    this.pullDeltas();
  }

  getNote(clientId: string): NoteRecord | null {
    const row = this.local.get(clientId);
    return row ? cloneNote(row) : null;
  }

  getConflictCopiesFor(clientId: string): NoteRecord[] {
    return [...this.local.values()]
      .filter((row) => row.clientId.startsWith(`${clientId}::conflict::`))
      .map(cloneNote);
  }

  private pullDeltas(): void {
    const since = this.watermark
      ? new Date(this.watermark.getTime() - 1_000)
      : undefined;
    const deltas = this.cloud.snapshotSince(since);
    for (const row of deltas) {
      this.applyRemote(row);
    }
  }

  private replayOutbox(): void {
    const pending = [...this.outbox.values()].sort(
      (a, b) => noteEventTime(a).getTime() - noteEventTime(b).getTime()
    );
    this.outbox.clear();

    for (const row of pending) {
      this.pushToCloud(row);
    }
  }

  private pushToCloud(row: NoteRecord): void {
    const accepted = this.cloud.applyUpsert(this.deviceId, row);
    if (!accepted) return;

    const local = this.local.get(row.clientId);
    if (!local) return;

    this.local.set(row.clientId, {
      ...local,
      syncedAt: new Date(noteEventTime(row)),
    });
  }

  private hasUnsyncedChanges(local: NoteRecord): boolean {
    return !local.syncedAt || noteEventTime(local).getTime() > local.syncedAt.getTime();
  }

  private applyRemote(remote: NoteRecord): void {
    const local = this.local.get(remote.clientId);
    const remoteEventMs = noteEventTime(remote).getTime();

    if (!local) {
      this.local.set(remote.clientId, {
        ...cloneNote(remote),
        syncedAt: new Date(noteEventTime(remote)),
      });
      this.bumpWatermark(new Date(remoteEventMs));
      return;
    }

    const localEventMs = noteEventTime(local).getTime();
    const remoteNewer =
      remoteEventMs > localEventMs ||
      (remoteEventMs === localEventMs && remote.version > local.version);

    if (!remoteNewer) {
      this.bumpWatermark(new Date(remoteEventMs));
      return;
    }

    if (
      !remote.deletedAt &&
      !local.deletedAt &&
      this.hasUnsyncedChanges(local) &&
      local.content !== remote.content
    ) {
      this.createConflictCopy(local);
    }

    this.local.set(remote.clientId, {
      ...cloneNote(remote),
      syncedAt: new Date(noteEventTime(remote)),
    });
    this.bumpWatermark(new Date(remoteEventMs));
  }

  private createConflictCopy(source: NoteRecord): void {
    this.conflictCounter += 1;
    const clientId = `${source.clientId}::conflict::${this.conflictCounter}`;
    this.local.set(clientId, {
      ...cloneNote(source),
      clientId,
      syncedAt: null,
      version: 1,
    });
  }

  private bumpWatermark(candidate: Date): void {
    if (!this.watermark || candidate.getTime() > this.watermark.getTime()) {
      this.watermark = new Date(candidate);
    }
  }
}

describe("Cross-device sync matrix harness", () => {
  const noteId = "note-1";
  const baseTime = new Date("2026-02-12T12:00:00.000Z");

  function seedCloudWithBase(cloud: CloudSimulator): void {
    cloud.seed({
      clientId: noteId,
      content: "base",
      updatedAt: baseTime,
      deletedAt: null,
      version: 1,
      deviceId: "seed",
      syncedAt: baseTime,
    });
  }

  it("online-online: edit on one device propagates immediately", () => {
    const cloud = new CloudSimulator();
    seedCloudWithBase(cloud);

    const deviceA = new DeviceSimulator("A", cloud);
    const deviceB = new DeviceSimulator("B", cloud);
    deviceA.runReconnectFlow();
    deviceB.runReconnectFlow();

    const editTime = new Date("2026-02-12T12:01:00.000Z");
    deviceA.edit(noteId, "edited-by-a", editTime);

    expect(deviceB.getNote(noteId)?.content).toBe("edited-by-a");
    expect(cloud.get(noteId)?.content).toBe("edited-by-a");
  });

  it("online-online: tombstone delete propagates to cloud and peers", () => {
    const cloud = new CloudSimulator();
    seedCloudWithBase(cloud);

    const deviceA = new DeviceSimulator("A", cloud);
    const deviceB = new DeviceSimulator("B", cloud);
    deviceA.runReconnectFlow();
    deviceB.runReconnectFlow();

    const deleteTime = new Date("2026-02-12T12:03:00.000Z");
    deviceA.delete(noteId, deleteTime);

    expect(cloud.get(noteId)?.deletedAt?.toISOString()).toBe(deleteTime.toISOString());
    expect(deviceB.getNote(noteId)?.deletedAt?.toISOString()).toBe(deleteTime.toISOString());
  });

  it("offline-online: offline change replays safely and keeps conflict copy when remote is newer", () => {
    const cloud = new CloudSimulator();
    seedCloudWithBase(cloud);

    const deviceA = new DeviceSimulator("A", cloud);
    const deviceB = new DeviceSimulator("B", cloud);
    deviceA.runReconnectFlow();
    deviceB.runReconnectFlow();

    deviceB.setOnline(false);
    deviceB.edit(noteId, "offline-edit", new Date("2026-02-12T12:01:00.000Z"));

    deviceA.edit(noteId, "online-newer-edit", new Date("2026-02-12T12:02:00.000Z"));

    deviceB.setOnline(true);
    deviceB.runReconnectFlow();

    expect(deviceB.getNote(noteId)?.content).toBe("online-newer-edit");
    expect(deviceB.getConflictCopiesFor(noteId)).toHaveLength(1);
    expect(cloud.get(noteId)?.content).toBe("online-newer-edit");
  });

  it("both offline: reconnect converges deterministically to newer change", () => {
    const cloud = new CloudSimulator();
    seedCloudWithBase(cloud);

    const deviceA = new DeviceSimulator("A", cloud);
    const deviceB = new DeviceSimulator("B", cloud);
    deviceA.runReconnectFlow();
    deviceB.runReconnectFlow();

    deviceA.setOnline(false);
    deviceB.setOnline(false);

    deviceA.edit(noteId, "a-offline", new Date("2026-02-12T12:01:00.000Z"));
    deviceB.edit(noteId, "b-offline-newer", new Date("2026-02-12T12:02:00.000Z"));

    deviceA.setOnline(true);
    deviceA.runReconnectFlow();

    deviceB.setOnline(true);
    deviceB.runReconnectFlow();

    expect(cloud.get(noteId)?.content).toBe("b-offline-newer");
    expect(deviceA.getNote(noteId)?.content).toBe("b-offline-newer");
    expect(deviceB.getNote(noteId)?.content).toBe("b-offline-newer");
  });

  it("pull/replay remains idempotent when the same delta is seen repeatedly", () => {
    const cloud = new CloudSimulator();
    seedCloudWithBase(cloud);

    const deviceA = new DeviceSimulator("A", cloud);
    const deviceB = new DeviceSimulator("B", cloud);
    deviceA.runReconnectFlow();
    deviceB.runReconnectFlow();

    deviceA.edit(noteId, "first-edit", new Date("2026-02-12T12:01:00.000Z"));
    deviceB.runReconnectFlow();
    const once = deviceB.getNote(noteId);

    deviceB.runReconnectFlow();
    const twice = deviceB.getNote(noteId);

    expect(twice?.content).toBe(once?.content);
    expect(deviceB.getConflictCopiesFor(noteId)).toHaveLength(0);
  });
});
