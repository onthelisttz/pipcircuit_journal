import { TagCategory } from "../enums";

export interface Tag {
  id?: number;
  /** Supabase row id for cross-device sync when local Dexie id differs. */
  remoteId?: number;
  /** Stable cross-device identity (UUID). */
  clientId?: string;
  name: string;
  category: TagCategory;
  color: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;
  deviceId?: string | null;
  syncedAt?: Date | null;
  version?: number;
}
