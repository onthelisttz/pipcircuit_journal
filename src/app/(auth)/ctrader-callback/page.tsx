"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { TokenStorage } from "@infrastructure/auth";

export default function CTraderCallbackPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [linked, setLinked] = useState(false);
  useEffect(() => {
    const errorParam = searchParams.get("error");
    if (errorParam) {
      setError(errorParam);
      if (window.opener) {
        window.opener.postMessage({ type: "ctrader-linked", error: errorParam }, "*");
        window.close();
      }
      return;
    }
    const code = searchParams.get("code");
    if (!code) {
      setError("Missing authorization code.");
      if (window.opener) {
        window.opener.postMessage({ type: "ctrader-linked", error: "missing_code" }, "*");
        window.close();
      }
      return;
    }

    const run = async () => {
      try {
        const response = await fetch(`/api/ctrader/token?code=${encodeURIComponent(code)}`);
        const token = (await response.json()) as {
          accessToken: string;
          refreshToken: string;
          expiresIn: number;
          error?: string;
        };
        if (!response.ok || token.error) {
          throw new Error(token.error ?? "Failed to exchange token.");
        }

        TokenStorage.setGlobal({
          accessToken: token.accessToken,
          refreshToken: token.refreshToken,
          expiresAt: Date.now() + token.expiresIn * 1000,
        });

        if (window.opener) {
          window.opener.postMessage({ type: "ctrader-linked" }, "*");
        }
        setLinked(true);
        setTimeout(() => window.close(), 150);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to link account.");
      }
    };

    void run();
  }, [router, searchParams]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">
      <div className="rounded-xl border border-border bg-card px-6 py-4 text-center">
        <div className="text-sm text-muted-foreground">
          {error ?? (linked ? "Account linked. You can close this window." : "Linking cTrader account...")}
        </div>
        <button
          onClick={() => window.close()}
          className="mt-4 rounded-lg border border-border px-4 py-2 text-xs text-foreground hover:bg-accent"
        >
          Close window
        </button>
      </div>
    </div>
  );
}
