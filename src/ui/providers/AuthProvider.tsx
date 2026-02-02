"use client";

import { type ReactNode, useEffect } from "react";

import { SupabaseAuthService } from "@infrastructure/auth";
import { useAuthStore } from "@ui/state";

const authService = new SupabaseAuthService();

export function AuthProvider({ children }: { children: ReactNode }) {
  const { setSession, setLoading } = useAuthStore();

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;

    const init = async () => {
      setLoading(true);
      const session = await authService.getSession();
      setSession(session);
      unsubscribe = authService.onAuthStateChange((nextSession) => {
        setSession(nextSession);
      });
    };

    void init();

    return () => {
      unsubscribe?.();
    };
  }, [setLoading, setSession]);

  return children;
}
