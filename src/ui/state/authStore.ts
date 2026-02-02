import { create } from "zustand";

import type { AuthSession, AuthUser } from "@application/ports/services";

interface AuthState {
  session: AuthSession | null;
  user: AuthUser | null;
  loading: boolean;
  setSession: (session: AuthSession | null) => void;
  setLoading: (loading: boolean) => void;
  clear: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  user: null,
  loading: true,
  setSession: (session) =>
    set({
      session,
      user: session?.user ?? null,
      loading: false,
    }),
  setLoading: (loading) => set({ loading }),
  clear: () => set({ session: null, user: null, loading: false }),
}));
