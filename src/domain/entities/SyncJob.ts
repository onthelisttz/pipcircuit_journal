import { SyncAction, SyncStatus } from "../enums";

export interface SyncJob {
  id?: number;
  action: SyncAction;
  table: string;
  entityId?: number | string;
  payload?: Record<string, unknown>;
  timestamp: Date;
  retryCount: number;
  status: SyncStatus;
  lastError?: string | null;
  nextRetryAt?: Date | null;
  deadLetterAt?: Date | null;
  lastAttemptAt?: Date | null;
}
