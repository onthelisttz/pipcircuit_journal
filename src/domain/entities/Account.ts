export type AccountType = "Demo" | "Live";

export interface Account {
  id?: number;
  ctraderAccountId?: number;
  accountNumber: string;
  platform: string;
  broker?: string;
  server?: string;
  name?: string;
  type?: AccountType;
  currency?: string;
  balance?: number;
  equity?: number;
  leverage?: number;
  isActive?: boolean;
  lastSyncAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
