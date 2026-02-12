"use client";

import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { SyncStatus } from "@domain/enums";
import { db } from "@infrastructure/db/dexie/database";

export type EntityQueueStatus = {
  pending: number;
  retrying: number;
  syncing: number;
  failed: number;
  total: number;
};

const EMPTY_STATUS: EntityQueueStatus = {
  pending: 0,
  retrying: 0,
  syncing: 0,
  failed: 0,
  total: 0,
};

export function useEntityQueueStatus(): {
  status: EntityQueueStatus;
  isLoading: boolean;
} {
  const jobs = useLiveQuery(
    () => db.sync_queue.filter((job) => job.table !== "chart_bars").toArray(),
    []
  );

  const status = useMemo<EntityQueueStatus>(() => {
    if (!jobs) {
      return EMPTY_STATUS;
    }

    const pending = jobs.filter(
      (job) => job.status === SyncStatus.Pending && (job.retryCount ?? 0) === 0
    ).length;
    const retrying = jobs.filter(
      (job) => job.status === SyncStatus.Pending && (job.retryCount ?? 0) > 0
    ).length;
    const syncing = jobs.filter((job) => job.status === SyncStatus.Syncing).length;
    const failed = jobs.filter((job) => job.status === SyncStatus.Error).length;

    return {
      pending,
      retrying,
      syncing,
      failed,
      total: pending + retrying + syncing + failed,
    };
  }, [jobs]);

  return {
    status,
    isLoading: jobs === undefined,
  };
}

