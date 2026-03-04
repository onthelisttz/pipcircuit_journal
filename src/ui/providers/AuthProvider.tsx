"use client";

import { type ReactNode, useEffect } from "react";

import { SupabaseAuthService } from "@infrastructure/auth";
import { useAuthStore } from "@ui/state";
import type { AuthSession } from "@application/ports/services";

const authService = new SupabaseAuthService();

/**
 * Try to recover a session from Supabase's localStorage entry.
 * The Supabase JS SDK stores its session under a key like
 * `sb-<project-ref>-auth-token`.
 */
function recoverSessionFromStorage(): AuthSession | null {
  if (typeof window === "undefined") return null;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith("sb-") && key.endsWith("-auth-token")) {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        // Supabase stores { currentSession: { ... } } or the session directly
        const session = parsed?.currentSession ?? parsed;
        if (session?.access_token && session?.user) {
          return {
            accessToken: session.access_token,
            refreshToken: session.refresh_token ?? undefined,
            expiresAt: session.expires_at ?? undefined,
            user: {
              id: session.user.id,
              email: session.user.email ?? undefined,
              name: session.user.user_metadata?.full_name ?? undefined,
              avatarUrl: session.user.user_metadata?.avatar_url ?? undefined,
            },
          };
        }
      }
    }
  } catch {
    // localStorage might be unavailable
  }
  return null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const { setSession, setLoading } = useAuthStore();

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;

    const init = async () => {
      setLoading(true);
      try {
        const session = await authService.getSession();
        setSession(session);
      } catch {
        // Offline or Supabase unreachable – try recovering from localStorage
        const cached = recoverSessionFromStorage();
        setSession(cached);
      }

      try {
        unsubscribe = authService.onAuthStateChange((nextSession) => {
          setSession(nextSession);
        });
      } catch {
        // Auth state listener failed (offline) – ignore, session is already set
      }
    };

    void init();

    return () => {
      unsubscribe?.();
    };
  }, [setLoading, setSession]);

  return children;
}
