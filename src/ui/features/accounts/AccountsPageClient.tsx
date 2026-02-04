"use client";

import { useAccountStore } from "@ui/state";
import { LinkCTraderAccountButton, SyncAccountsButton } from "./index";

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins} min ago`;
  if (diffHours < 24) return `${diffHours} hr ago`;
  if (diffDays < 7) return `${diffDays} days ago`;
  return date.toLocaleDateString();
}

export function AccountsPageClient() {
  const { lastAccountsSyncAt } = useAccountStore();

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Accounts</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Link cTrader accounts and manage active account context.
        </p>
        {lastAccountsSyncAt && (
          <p className="mt-1 text-xs text-muted-foreground">
            Accounts synced: {formatRelativeTime(lastAccountsSyncAt)}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2">
        <SyncAccountsButton />
        <LinkCTraderAccountButton />
      </div>
    </div>
  );
}
