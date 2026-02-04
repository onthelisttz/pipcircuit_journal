"use client";

import { RefreshCw } from "lucide-react";
import { useAccount } from "@ui/hooks";
import { useState } from "react";

export function SyncAccountsButton() {
  const { syncFromCTrader } = useAccount();
  const [loading, setLoading] = useState(false);

  return (
    <button
      onClick={async () => {
        if (loading) return;
        setLoading(true);
        try {
          await syncFromCTrader();
        } finally {
          setLoading(false);
        }
      }}
      disabled={loading}
      className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-60 disabled:cursor-not-allowed"
      aria-label="Sync accounts from cTrader"
    >
      <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
      {loading ? "Syncing..." : "Sync accounts"}
    </button>
  );
}
