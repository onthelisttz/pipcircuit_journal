"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Pencil, Check, Download, MoreVertical, Database, Trash2, RefreshCw,
  ChevronUp, ChevronDown,
} from "lucide-react";

import { useAccount } from "@ui/hooks";
import type { Account } from "@domain/entities";

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

function formatSyncTime(date: Date | null | undefined): string {
  if (!date) return "Never";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

type SortKey = "name" | "accountNumber" | "server" | "type" | "platform" | "balance" | "lastSyncAt";
type SortDir = "asc" | "desc";

interface SortState {
  key: SortKey;
  dir: SortDir;
}

interface MenuAnchor {
  accountNumber: string;
  btnBottom: number;
  btnTop: number;
  btnRight: number;
}

interface DeleteDialogState {
  accountNumber: string;
  accountName: string;
  accountType: string;
  accountBalance?: number;
  open: boolean;
}

interface ColumnDef {
  key: SortKey;
  label: string;
  sortable: boolean;
}

function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const columns: ColumnDef[] = [
  { key: "name", label: "Name", sortable: true },
  { key: "accountNumber", label: "Number", sortable: true },
  { key: "server", label: "Server", sortable: true },
  { key: "type", label: "Type", sortable: true },
  { key: "platform", label: "Platform", sortable: true },
  { key: "balance", label: "Balance", sortable: true },
  { key: "lastSyncAt", label: "Last trades sync", sortable: true },
];

function getSortValue(account: Account, key: SortKey): string | number {
  switch (key) {
    case "name": return (account.name ?? account.broker ?? "").toLowerCase();
    case "accountNumber": return account.accountNumber;
    case "server": return (account.server ?? "").toLowerCase();
    case "type": return (account.type ?? "").toLowerCase();
    case "platform": return account.platform.toLowerCase();
    case "balance": return account.balance ?? 0;
    case "lastSyncAt": return account.lastSyncAt?.getTime() ?? 0;
  }
}

export function AccountsTable() {
  const {
    accounts,
    activeAccountId,
    setActive,
    renameAccount,
    syncTradesForAccount,
    clearLastSyncAt,
    pullTradesFromSupabase,
    deleteTrades,
  } = useAccount();

  const [renameTarget, setRenameTarget] = useState<{
    id: number;
    accountNumber: string;
    name: string;
  } | null>(null);
  const [nameInput, setNameInput] = useState("");
  const [syncingAccount, setSyncingAccount] = useState<string | null>(null);
  const [pullingAccount, setPullingAccount] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<MenuAnchor | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<DeleteDialogState | null>(null);
  const [deleteAll, setDeleteAll] = useState(false);
  const [deleteFrom, setDeleteFrom] = useState(todayStr);
  const [deleteTo, setDeleteTo] = useState(todayStr);
  const [deleteScope, setDeleteScope] = useState<"local" | "both">("local");
  const [deleting, setDeleting] = useState(false);
  const [sort, setSort] = useState<SortState>({ key: "name", dir: "asc" });

  const sortedAccounts = useMemo(() => {
    const sorted = [...accounts].sort((a, b) => {
      const aVal = getSortValue(a, sort.key);
      const bVal = getSortValue(b, sort.key);
      let cmp = 0;
      if (typeof aVal === "string" && typeof bVal === "string") {
        cmp = aVal.localeCompare(bVal);
      } else {
        cmp = (aVal as number) - (bVal as number);
      }
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [accounts, sort]);

  const handleSort = (key: SortKey) => {
    setSort((prev) => ({
      key,
      dir: prev.key === key && prev.dir === "asc" ? "desc" : "asc",
    }));
  };

  useEffect(() => {
    if (!errorMessage) return;
    const timer = setTimeout(() => {
      setErrorMessage(null);
    }, 5000);
    return () => clearTimeout(timer);
  }, [errorMessage]);

  if (accounts.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground sm:p-6">
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

      {/* Rename dialog */}
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
                  if (!renameTarget) return;
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

      {/* Delete trades dialog */}
      {deleteDialog?.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-lg">
            <h2 className="text-lg font-semibold text-foreground">Delete trades</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Account: {deleteDialog.accountName} ({deleteDialog.accountType})
              {deleteDialog.accountBalance != null && ` – $${formatBalance(deleteDialog.accountBalance, undefined)}`}
            </p>
            <div className="mt-4 space-y-4">
              <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={deleteAll}
                  onChange={(e) => setDeleteAll(e.target.checked)}
                  className="accent-destructive"
                />
                <span className="font-medium">Delete all trades</span>
              </label>
              <div className={`flex gap-3 transition-opacity ${deleteAll ? "opacity-40 pointer-events-none" : ""}`}>
                <div className="flex-1">
                  <label className="text-xs text-muted-foreground">From</label>
                  <input
                    type="date"
                    value={deleteFrom}
                    onChange={(e) => setDeleteFrom(e.target.value)}
                    className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                  />
                </div>
                <div className="flex-1">
                  <label className="text-xs text-muted-foreground">To</label>
                  <input
                    type="date"
                    value={deleteTo}
                    onChange={(e) => setDeleteTo(e.target.value)}
                    className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Scope</label>
                <div className="mt-1 flex gap-4">
                  <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                    <input
                      type="radio"
                      name="deleteScope"
                      value="local"
                      checked={deleteScope === "local"}
                      onChange={() => setDeleteScope("local")}
                      className="accent-primary"
                    />
                    Local only
                  </label>
                  <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                    <input
                      type="radio"
                      name="deleteScope"
                      value="both"
                      checked={deleteScope === "both"}
                      onChange={() => setDeleteScope("both")}
                      className="accent-primary"
                    />
                    Both (local + cloud)
                  </label>
                </div>
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={() => {
                  setDeleteDialog(null);
                  setDeleteAll(false);
                  setDeleteFrom(todayStr());
                  setDeleteTo(todayStr());
                  setDeleteScope("local");
                }}
                disabled={deleting}
                className="rounded-lg border border-border px-4 py-2 text-sm text-foreground hover:bg-accent disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  setDeleting(true);
                  try {
                    const from = deleteAll ? undefined : (deleteFrom ? new Date(deleteFrom) : undefined);
                    const to = deleteAll ? undefined : (deleteTo ? new Date(deleteTo) : undefined);
                    await deleteTrades(
                      deleteDialog.accountNumber,
                      deleteScope,
                      from,
                      to
                    );
                    setDeleteDialog(null);
                    setDeleteAll(false);
                    setDeleteFrom(todayStr());
                    setDeleteTo(todayStr());
                    setDeleteScope("local");
                  } catch (error) {
                    setErrorMessage(
                      error instanceof Error ? error.message : "Failed to delete trades"
                    );
                  } finally {
                    setDeleting(false);
                  }
                }}
                disabled={deleting}
                className="rounded-lg bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
              >
                {deleting ? "Deleting..." : deleteAll ? "Delete all" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Menu backdrop + fixed menu */}
      {menuAnchor && (
        <div
          className="fixed inset-0 z-30"
          onClick={() => setMenuAnchor(null)}
        />
      )}

      <div className="overflow-x-auto">
        <table className="min-w-[900px] w-full text-left text-sm">
        <thead className="border-b border-border text-muted-foreground">
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className={`px-4 py-3 ${col.sortable ? "cursor-pointer select-none hover:text-foreground" : ""}`}
                onClick={() => col.sortable && handleSort(col.key)}
              >
                <span className="inline-flex items-center gap-1">
                  {col.label}
                  {sort.key === col.key ? (
                    sort.dir === "asc" ? (
                      <ChevronUp className="h-3.5 w-3.5 text-foreground" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5 text-foreground" />
                    )
                  ) : col.sortable ? (
                    <ChevronUp className="h-3.5 w-3.5 opacity-30" />
                  ) : null}
                </span>
              </th>
            ))}
            <th className="px-4 py-3">Actions</th>
          </tr>
        </thead>
        <tbody>
          {sortedAccounts.map((account) => {
            const typeLabel = account.type ?? "Unknown";
            const isLiveType = typeLabel.toLowerCase() === "live";

            return (
            <tr key={account.id} className="border-b border-border last:border-0">
              <td className="px-4 py-3">{account.name ?? account.broker ?? "cTrader"}</td>
              <td className="px-4 py-3">{account.accountNumber}</td>
              <td className="px-4 py-3">{account.server ?? account.broker ?? "-"}</td>
              <td className="px-4 py-3">
                <span className={isLiveType ? "font-medium text-emerald-500" : undefined}>
                  {typeLabel}
                </span>
              </td>
              <td className="px-4 py-3">cTrader</td>
              <td className="px-4 py-3">
                <span>${formatBalance(account.balance, undefined)}</span>
              </td>
              <td className="px-4 py-3">
                <span>{formatSyncTime(account.lastSyncAt)}</span>
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-1.5">
                  {/* Download from cTrader */}
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
                    className="inline-flex items-center justify-center rounded-lg border border-border p-2 text-xs text-foreground hover:bg-accent disabled:opacity-60 disabled:cursor-not-allowed"
                    aria-label="Download trades from cTrader"
                    title="Download from cTrader"
                  >
                    <Download
                      className={`h-3.5 w-3.5 ${
                        syncingAccount === account.accountNumber ? "animate-spin" : ""
                      }`}
                    />
                  </button>

                  {/* Set Active / Active badge */}
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

                  {/* 3-dot menu (fixed position) */}
                  {account.id && (
                    <div>
                      <button
                        onClick={(event) => {
                          if (menuAnchor?.accountNumber === account.accountNumber) {
                            setMenuAnchor(null);
                          } else {
                            const rect = event.currentTarget.getBoundingClientRect();
                            setMenuAnchor({
                              accountNumber: account.accountNumber,
                              btnBottom: rect.bottom,
                              btnTop: rect.top,
                              btnRight: window.innerWidth - rect.right,
                            });
                          }
                        }}
                        className="inline-flex items-center justify-center rounded-lg border border-border p-2 text-xs text-foreground hover:bg-accent"
                        aria-label="More actions"
                        aria-haspopup="menu"
                        aria-expanded={menuAnchor?.accountNumber === account.accountNumber}
                      >
                        <MoreVertical className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              </td>
            </tr>
          )})}
        </tbody>
        </table>
      </div>

      {/* Fixed-position menu (not inside table/card, so no clipping) */}
      {menuAnchor && (
        <div
          className="fixed z-40 w-56 rounded-lg border border-border bg-popover p-1 text-sm shadow-lg"
          style={{
            top: window.innerHeight - menuAnchor.btnBottom < 280
              ? undefined
              : menuAnchor.btnBottom + 4,
            bottom: window.innerHeight - menuAnchor.btnBottom < 280
              ? window.innerHeight - menuAnchor.btnTop + 4
              : undefined,
            right: menuAnchor.btnRight,
          }}
          role="menu"
        >
          {(() => {
            const account = accounts.find((a) => a.accountNumber === menuAnchor.accountNumber);
            if (!account) return null;
            return (
              <>
                <button
                  onClick={async () => {
                    setMenuAnchor(null);
                    setPullingAccount(account.accountNumber);
                    setErrorMessage(null);
                    try {
                      await pullTradesFromSupabase(account.accountNumber);
                    } catch (error) {
                      setErrorMessage(
                        error instanceof Error ? error.message : "Failed to pull from Supabase"
                      );
                    } finally {
                      setPullingAccount(null);
                    }
                  }}
                  disabled={pullingAccount === account.accountNumber}
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left hover:bg-accent disabled:opacity-50"
                  role="menuitem"
                >
                  <Database className={`h-4 w-4 ${pullingAccount === account.accountNumber ? "animate-spin" : ""}`} />
                  <span>Pull from Supabase</span>
                </button>
                <button
                  onClick={() => {
                    setMenuAnchor(null);
                    setDeleteDialog({
                      accountNumber: account.accountNumber,
                      accountName: account.name ?? account.broker ?? "cTrader",
                      accountType: account.type ?? "Unknown",
                      accountBalance: account.balance,
                      open: true,
                    });
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left hover:bg-accent"
                  role="menuitem"
                >
                  <Trash2 className="h-4 w-4" />
                  <span>Delete trades...</span>
                </button>
                {account.lastSyncAt && (
                  <button
                    onClick={() => {
                      setMenuAnchor(null);
                      if (account.id) {
                        void clearLastSyncAt(account.id);
                      }
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left hover:bg-accent"
                    role="menuitem"
                  >
                    <RefreshCw className="h-4 w-4" />
                    <span>Clear last sync</span>
                  </button>
                )}
                <div className="my-1 border-t border-border" />
                <button
                  onClick={() => {
                    setMenuAnchor(null);
                    setRenameTarget({
                      id: account.id!,
                      accountNumber: account.accountNumber,
                      name: account.name ?? account.broker ?? "cTrader",
                    });
                    setNameInput(account.name ?? account.broker ?? "");
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left hover:bg-accent"
                  role="menuitem"
                >
                  <Pencil className="h-4 w-4" />
                  <span>Rename</span>
                </button>
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}
