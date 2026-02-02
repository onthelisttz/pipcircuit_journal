import { create } from "zustand";

import type { Account } from "@domain/entities";

interface AccountState {
  accounts: Account[];
  activeAccountId: number | null;
  setAccounts: (accounts: Account[]) => void;
  setActiveAccountId: (accountId: number | null) => void;
}

export const useAccountStore = create<AccountState>((set) => ({
  accounts: [],
  activeAccountId: null,
  setAccounts: (accounts) => set({ accounts }),
  setActiveAccountId: (activeAccountId) => set({ activeAccountId }),
}));
