import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { Account } from "@domain/entities";

function getDefaultStorage() {
  if (typeof window === "undefined") {
    return {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    };
  }
  return {
    getItem: (name: string) => localStorage.getItem(name),
    setItem: (name: string, value: string) => localStorage.setItem(name, value),
    removeItem: (name: string) => localStorage.removeItem(name),
  };
}

interface AccountState {
  accounts: Account[];
  activeAccountId: number | null;
  lastAccountsSyncAt: Date | null;
  setAccounts: (accounts: Account[]) => void;
  setActiveAccountId: (accountId: number | null) => void;
  setLastAccountsSyncAt: (date: Date | null) => void;
}

export const useAccountStore = create<AccountState>()(
  persist(
    (set) => ({
      accounts: [],
      activeAccountId: null,
      lastAccountsSyncAt: null,
      setAccounts: (accounts) => set({ accounts }),
      setActiveAccountId: (activeAccountId) => set({ activeAccountId }),
      setLastAccountsSyncAt: (lastAccountsSyncAt) => set({ lastAccountsSyncAt }),
    }),
    {
      name: "account-sync-meta",
      partialize: (state) => ({
        lastAccountsSyncAt: state.lastAccountsSyncAt,
      }),
      storage: {
        getItem: (name) => {
          const str = getDefaultStorage().getItem(name);
          if (!str) return null;
          try {
            const parsed = JSON.parse(str);
            if (parsed?.state?.lastAccountsSyncAt) {
              parsed.state.lastAccountsSyncAt = new Date(parsed.state.lastAccountsSyncAt);
            }
            return parsed;
          } catch {
            return null;
          }
        },
        setItem: (name, value) => {
          getDefaultStorage().setItem(name, value);
        },
        removeItem: (name) => {
          getDefaultStorage().removeItem(name);
        },
      },
    }
  )
);
