export interface ObservationCategory {
  id?: number;
  /** Supabase row id for cross-device sync when local Dexie id differs. */
  remoteId?: number;
  /** Stable cross-device identity (UUID). */
  clientId?: string;
  name: string;
  color: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;
  deviceId?: string | null;
  syncedAt?: Date | null;
  version?: number;
}
