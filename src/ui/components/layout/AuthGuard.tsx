"use client";

import { type ReactNode, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { useAuth } from "@ui/hooks";

const AUTH_TIMEOUT_MS = 3000;

export function AuthGuard({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [timedOut, setTimedOut] = useState(false);

  // After AUTH_TIMEOUT_MS, stop waiting for auth if we're offline
  useEffect(() => {
    const timer = setTimeout(() => {
      setTimedOut(true);
    }, AUTH_TIMEOUT_MS);

    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!loading && !user) {
      // If offline, don't redirect – show cached content
      const isOffline =
        typeof navigator !== "undefined" && !navigator.onLine;
      if (!isOffline) {
        router.replace("/login");
      }
    }
  }, [loading, router, user]);

  // Show the app if:
  // 1. User is authenticated, OR
  // 2. We're offline and timed out waiting for auth (show cached data)
  if (user) {
    return <>{children}</>;
  }

  const isOffline = typeof navigator !== "undefined" && !navigator.onLine;
  if (isOffline && timedOut) {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">
      Loading...
    </div>
  );
}
