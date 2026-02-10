"use client";

import { useAuth } from "@ui/hooks";

export function LoginPage() {
  const { login, loading } = useAuth();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-foreground">Sign in</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Continue with Google to access your pipCircuit workspace.
        </p>
        <button
          onClick={() => void login()}
          disabled={loading}
          className="mt-6 w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground
          transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {loading ? "Loading..." : "Sign in with Google"}
        </button>
      </div>
    </div>
  );
}
