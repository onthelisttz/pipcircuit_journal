"use client";

import { useEffect, useState } from "react";
import { Pencil, Check, Download } from "lucide-react";

import { useAccount } from "@ui/hooks";

function formatBalance(balance?: number, currency?: string) {
  if (balance === undefined) {
    return "-";
  }
  return new Intl.NumberFormat("en-US", {
    style: currency ? "currency" : "decimal",
    currency: currency ?? "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(balance);
}

export function AccountsTable() {
  const { accounts, activeAccountId, setActive, renameAccount, syncFromCTrader, syncTradesForAccount } =
    useAccount();
  const [renameTarget, setRenameTarget] = useState<{
    id: number;
    accountNumber: string;
    name: string;
  } | null>(null);
  const [nameInput, setNameInput] = useState("");
  const [syncingAccount, setSyncingAccount] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!errorMessage) return;
    const timer = setTimeout(() => {
      setErrorMessage(null);
    }, 5000);
    return () => clearTimeout(timer);
  }, [errorMessage]);

  if (accounts.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
        No accounts linked yet.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      {errorMessage && (
        <div className="border-b border-border bg-destructive/5 px-4 py-2 text-xs text-destructive">
          {errorMessage}
        </div>
      )}
      {renameTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-lg">
            <h2 className="text-lg font-semibold text-foreground">Rename account</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Update the display name for this account.
            </p>
            <div className="mt-4 space-y-3">
              <label className="text-xs text-muted-foreground">Account number</label>
              <input
                value={renameTarget.accountNumber}
                readOnly
                className="w-full rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground"
              />
              <label className="text-xs text-muted-foreground">Account name</label>
              <input
                value={nameInput}
                onChange={(event) => setNameInput(event.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                placeholder="Enter a name"
              />
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={() => setRenameTarget(null)}
                className="rounded-lg border border-border px-4 py-2 text-sm text-foreground hover:bg-accent"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (!renameTarget) {
                    return;
                  }
                  void renameAccount(renameTarget.id, nameInput.trim() || renameTarget.name);
                  setRenameTarget(null);
                }}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="min-w-[900px] w-full text-left text-sm">
        <thead className="border-b border-border text-muted-foreground">
          <tr>
            <th className="px-4 py-3">Name</th>
            <th className="px-4 py-3">Number</th>
            <th className="px-4 py-3">Server</th>
            <th className="px-4 py-3">Type</th>
            <th className="px-4 py-3">Platform</th>
            <th className="px-4 py-3">Balance</th>
            <th className="px-4 py-3">Connection</th>
            <th className="px-4 py-3">Last trades sync</th>
            <th className="px-4 py-3">Actions</th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((account) => (
            <tr key={account.id} className="border-b border-border last:border-0">
              <td className="px-4 py-3">{account.name ?? account.broker ?? "cTrader"}</td>
              <td className="px-4 py-3">{account.accountNumber}</td>
              <td className="px-4 py-3">{account.server ?? account.broker ?? "-"}</td>
              <td className="px-4 py-3">{account.type ?? "Unknown"}</td>
              <td className="px-4 py-3">cTrader</td>
              <td className="px-4 py-3">
                <span>${formatBalance(account.balance, undefined)}</span>
              </td>
              <td className="px-4 py-3">API</td>
              <td className="px-4 py-3">
                {account.lastSyncAt
                  ? new Intl.DateTimeFormat("en-US", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(account.lastSyncAt)
                  : "Never"}
              </td>
              <td className="px-4 py-3">
                {account.id && account.id === activeAccountId ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-3 py-1 text-xs text-emerald-500">
                    <Check className="h-3 w-3" />
                    Active
                  </span>
                ) : (
                  account.id && (
                    <button
                      onClick={() => void setActive(account.id!)}
                      className="rounded-lg border border-border px-3 py-1 text-xs text-foreground hover:bg-accent"
                    >
                      Set Active
                    </button>
                  )
                )}
                {account.id && (
                  <button
                    onClick={() => {
                      setRenameTarget({
                        id: account.id!,
                        accountNumber: account.accountNumber,
                        name: account.name ?? account.broker ?? "cTrader",
                      });
                      setNameInput(account.name ?? account.broker ?? "");
                    }}
                    className="ml-2 inline-flex items-center justify-center rounded-lg border border-border p-2 text-xs text-foreground hover:bg-accent"
                    aria-label="Rename account"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                )}
                <button
                  onClick={async () => {
                    if (syncingAccount) return;
                    setErrorMessage(null);
                    setSyncingAccount(account.accountNumber);
                    try {
                      await syncTradesForAccount(
                        account.accountNumber,
                        account.ctraderAccountId
                      );
                    } catch (error) {
                      const message =
                        error instanceof Error ? error.message : "Failed to sync trades";
                      if (message === "Missing cTrader token") {
                        setErrorMessage(
                          "Please link your cTrader account before syncing trades."
                        );
                      } else {
                        setErrorMessage(message);
                      }
                    } finally {
                      setSyncingAccount(null);
                    }
                  }}
                  disabled={syncingAccount === account.accountNumber}
                  className="ml-2 inline-flex items-center justify-center rounded-lg border border-border p-2 text-xs text-foreground hover:bg-accent disabled:opacity-60 disabled:cursor-not-allowed"
                  aria-label="Sync trades"
                >
                  <Download
                    className={`h-3.5 w-3.5 ${
                      syncingAccount === account.accountNumber ? "animate-spin" : ""
                    }`}
                  />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
        </table>
      </div>
    </div>
  );
}
